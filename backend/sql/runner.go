package schema

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

type Bootstrap func(context.Context, *sql.Tx, bool) error
type Result struct {
	Version        int
	Applied        []string
	Fresh, Adopted bool
}
type VersionStatus struct {
	Version int    `json:"version"`
	Name    string `json:"name"`
	Applied bool   `json:"applied"`
}
type Status struct {
	Version    int             `json:"version"`
	Untracked  bool            `json:"untracked"`
	Migrations []VersionStatus `json:"migrations"`
}
type appliedMigration struct {
	version        int
	name, checksum string
}

// Initialize is the test/database bootstrap entrypoint without administrator seeding.
func Initialize(ctx context.Context, db *sql.DB) error {
	r, err := Default()
	if err != nil {
		return err
	}
	_, err = r.Apply(ctx, db, nil)
	return err
}

func targetSchema(ctx context.Context, tx *sql.Tx) (string, error) {
	var name sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT current_schema()").Scan(&name); err != nil {
		return "", err
	}
	if !name.Valid || name.String == "information_schema" || strings.HasPrefix(name.String, "pg_") {
		return "", fmt.Errorf("数据库未选择可用的业务 schema")
	}
	var shadowed bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.oid IN (to_regclass('users'),to_regclass('schema_migrations')) AND n.nspname<>$1)`, name.String).Scan(&shadowed); err != nil {
		return "", err
	}
	if shadowed {
		return "", fmt.Errorf("search_path 会遮蔽另一个 schema 中已有的业务表，请显式指定正确 schema 后重试")
	}
	return name.String, nil
}
func useSchema(ctx context.Context, tx *sql.Tx, name string) error {
	_, err := tx.ExecContext(ctx, "SELECT set_config('search_path',$1,true)", pgx.Identifier{name}.Sanitize()+", pg_catalog")
	return err
}
func inventory(ctx context.Context, tx *sql.Tx, name string) (bool, int, error) {
	var ledger bool
	var business int
	err := tx.QueryRowContext(ctx, `SELECT COALESCE(bool_or(c.relname='schema_migrations'),false),count(*) FILTER(WHERE c.relname<>'schema_migrations')
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','f','S')`, name).Scan(&ledger, &business)
	return ledger, business, err
}
func history(ctx context.Context, tx *sql.Tx) ([]appliedMigration, error) {
	rows, err := tx.QueryContext(ctx, "SELECT version,name,checksum FROM schema_migrations ORDER BY version")
	if err != nil {
		return nil, fmt.Errorf("读取迁移记录失败：%w", err)
	}
	defer rows.Close()
	var result []appliedMigration
	for rows.Next() {
		var row appliedMigration
		if err = rows.Scan(&row.version, &row.name, &row.checksum); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}
func (r *Runner) validateHistory(rows []appliedMigration) error {
	if len(rows) == 0 {
		return fmt.Errorf("迁移记录表为空，拒绝猜测数据库版本")
	}
	for i, row := range rows {
		if i >= len(r.migrations) || row.version != i {
			return fmt.Errorf("数据库迁移版本未知、不连续或高于当前镜像，禁止降级启动")
		}
		m := r.migrations[i]
		if row.name != m.name || row.checksum != m.checksum {
			return fmt.Errorf("已执行迁移 %s 的名称或校验值发生变化，请恢复原文件并新增迁移", m.name)
		}
	}
	return nil
}
func record(ctx context.Context, tx *sql.Tx, m migration) error {
	_, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3)", m.version, m.name, m.checksum)
	return err
}

func (r *Runner) Apply(ctx context.Context, db *sql.DB, bootstrap Bootstrap) (Result, error) {
	result := Result{Version: -1, Applied: []string{}}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SET LOCAL lock_timeout='15s'"); err != nil {
		return result, err
	}
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(531284527)"); err != nil {
		return result, err
	}
	name, err := targetSchema(ctx, tx)
	if err != nil {
		return result, err
	}
	if err = useSchema(ctx, tx, name); err != nil {
		return result, err
	}
	hasLedger, business, err := inventory(ctx, tx, name)
	if err != nil {
		return result, err
	}
	next := 0
	if hasLedger {
		rows, e := history(ctx, tx)
		if e != nil {
			return result, e
		}
		if e = r.validateHistory(rows); e != nil {
			return result, e
		}
		next = len(rows)
		if next == 1 && business != 0 {
			return result, fmt.Errorf("仅记录了版本 000，但数据库中已有业务关系，拒绝初始化")
		}
		result.Fresh = next == 1
	} else if business == 0 {
		result.Fresh = true
	} else {
		if err = r.verifyBaseline(ctx, tx, name); err != nil {
			return result, err
		}
		result.Adopted = true
		if err = executeMigration(ctx, tx, r.migrations[0].sql); err != nil {
			return result, err
		}
		for _, m := range r.migrations[:2] {
			if err = record(ctx, tx, m); err != nil {
				return result, err
			}
		}
		next = 2
	}
	for _, m := range r.migrations[next:] {
		if err = executeMigration(ctx, tx, m.sql); err != nil {
			return Result{}, fmt.Errorf("迁移 %s 失败，当前升级事务已回滚：%w", m.name, err)
		}
		if err = record(ctx, tx, m); err != nil {
			return Result{}, err
		}
		result.Applied = append(result.Applied, m.name)
	}
	if bootstrap != nil {
		if err = bootstrap(ctx, tx, result.Fresh); err != nil {
			return Result{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Result{}, err
	}
	result.Version = r.migrations[len(r.migrations)-1].version
	return result, nil
}

// Status never creates a schema, a ledger or a baseline comparison namespace.
func (r *Runner) Status(ctx context.Context, db *sql.DB) (Status, error) {
	result := Status{Version: -1, Migrations: []VersionStatus{}}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	name, err := targetSchema(ctx, tx)
	if err != nil {
		return result, err
	}
	if err = useSchema(ctx, tx, name); err != nil {
		return result, err
	}
	ledger, business, err := inventory(ctx, tx, name)
	if err != nil {
		return result, err
	}
	applied := 0
	if ledger {
		rows, e := history(ctx, tx)
		if e != nil {
			return result, e
		}
		if e = r.validateHistory(rows); e != nil {
			return result, e
		}
		applied = len(rows)
		result.Version = rows[applied-1].version
	} else {
		result.Untracked = business > 0
	}
	for i, m := range r.migrations {
		result.Migrations = append(result.Migrations, VersionStatus{m.version, m.name, i < applied})
	}
	return result, tx.Commit()
}
