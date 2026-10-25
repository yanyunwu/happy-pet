// Package schema owns the immutable SQL migrations used by sqlc and deployment.
package schema

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

//go:embed migrations/*.sql
var embedded embed.FS

type migration struct {
	version             int
	name, sql, checksum string
}
type Runner struct{ migrations []migration }

var migrationName = regexp.MustCompile(`^([0-9]{3,})_[a-z][a-z0-9_]*\.sql$`)

func Default() (*Runner, error) {
	source, err := fs.Sub(embedded, "migrations")
	if err != nil {
		return nil, err
	}
	return New(source)
}

// New validates an ordered migration source before any database writes occur.
func New(source fs.FS) (*Runner, error) {
	entries, err := fs.ReadDir(source, ".")
	if err != nil {
		return nil, err
	}
	r := &Runner{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		match := migrationName.FindStringSubmatch(entry.Name())
		if match == nil {
			return nil, fmt.Errorf("迁移文件命名无效：%s", entry.Name())
		}
		version, e := strconv.Atoi(match[1])
		if e != nil || version > 2147483647 {
			return nil, fmt.Errorf("迁移版本无效：%s", entry.Name())
		}
		data, e := fs.ReadFile(source, entry.Name())
		if e != nil {
			return nil, e
		}
		sql := strings.ReplaceAll(string(data), "\r\n", "\n")
		if e = validateMigrationSQL(sql); e != nil {
			return nil, fmt.Errorf("%s：%w", entry.Name(), e)
		}
		hash := sha256.Sum256([]byte(sql))
		r.migrations = append(r.migrations, migration{version, entry.Name(), sql, hex.EncodeToString(hash[:])})
	}
	sort.Slice(r.migrations, func(i, j int) bool { return r.migrations[i].version < r.migrations[j].version })
	if len(r.migrations) < 2 || r.migrations[0].name != "000_schema_migrations.sql" || r.migrations[1].name != "001_initial.sql" {
		return nil, fmt.Errorf("缺少迁移记录表或初始结构迁移")
	}
	for i, m := range r.migrations {
		if m.version != i {
			return nil, fmt.Errorf("迁移版本必须从 000 开始连续且不重复：%s", m.name)
		}
	}
	return r, nil
}
