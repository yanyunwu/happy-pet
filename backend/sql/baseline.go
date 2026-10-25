package schema

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Compare catalog structure, never table contents. OIDs for types/opclasses are
// compared inside one database; both namespaces use the same PostgreSQL build.
const structureSQL = `SELECT COALESCE(jsonb_agg(jsonb_build_object(
 'name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,
 'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,
 'replica_identity',c.relreplident,'partition',c.relispartition,'options',c.reloptions,
 'columns',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
   'identity',a.attidentity,'generated',a.attgenerated,'collation',a.attcollation,
   'default',pg_get_expr(d.adbin,d.adrelid,true)) ORDER BY a.attnum),'[]'::jsonb)
   FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid,true),
   'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred)
   ORDER BY k.conname),'[]'::jsonb) FROM pg_constraint k WHERE k.conrelid=c.oid),
 'indexes',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'name',ic.relname,'method',am.amname,'unique',i.indisunique,'primary',i.indisprimary,
   'valid',i.indisvalid,'ready',i.indisready,'immediate',i.indimmediate,
   'nulls_not_distinct',i.indnullsnotdistinct,'key_count',i.indnkeyatts,
   'columns',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid,k,true) ORDER BY k) FROM generate_series(1,i.indnatts) k),
   'classes',i.indclass::text,'collations',i.indcollation::text,'ordering',i.indoption::text,
   'predicate',pg_get_expr(i.indpred,i.indrelid,true),'options',ic.reloptions)
   ORDER BY ic.relname),'[]'::jsonb) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid
   JOIN pg_am am ON am.oid=ic.relam WHERE i.indrelid=c.oid),
 'rewrite_rules',(SELECT count(*) FROM pg_rewrite rules WHERE rules.ev_class=c.oid),
 'custom_triggers',(SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
 'internal_triggers_enabled',(SELECT COALESCE(bool_and(t.tgenabled='O'),true) FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgisinternal),
 'policies',(SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)
) ORDER BY c.relname),'[]'::jsonb)::text
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname=$1 AND c.relname<>'schema_migrations' AND c.relkind IN ('r','p','v','m','f','S')`

func snapshot(ctx context.Context, tx *sql.Tx, name string) ([]byte, error) {
	if err := useSchema(ctx, tx, name); err != nil {
		return nil, err
	}
	var result []byte
	err := tx.QueryRowContext(ctx, structureSQL, name).Scan(&result)
	return result, err
}

func (r *Runner) verifyBaseline(ctx context.Context, tx *sql.Tx, target string) error {
	actual, err := snapshot(ctx, tx, target)
	if err != nil {
		return err
	}
	var nonce [12]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		return err
	}
	probe := "happy_pet_compare_" + hex.EncodeToString(nonce[:])
	quoted := pgx.Identifier{probe}.Sanitize()
	if _, err = tx.ExecContext(ctx, "CREATE SCHEMA "+quoted); err != nil {
		return fmt.Errorf("无法创建基线校验 schema，请确认迁移账号权限：%w", err)
	}
	if err = useSchema(ctx, tx, probe); err != nil {
		return err
	}
	if err = executeMigration(ctx, tx, r.migrations[1].sql); err != nil {
		return err
	}
	expected, err := snapshot(ctx, tx, probe)
	if err != nil {
		return err
	}
	if !bytes.Equal(actual, expected) {
		return fmt.Errorf("现有数据库与已发布的初始结构不匹配，拒绝自动接入迁移；请检查表、列、约束和索引，已有数据未修改")
	}
	if err = useSchema(ctx, tx, target); err != nil {
		return err
	}
	// This namespace was generated and created by this transaction, never supplied
	// by the operator. A rollback also removes it if comparison or upgrade fails.
	_, err = tx.ExecContext(ctx, "DROP SCHEMA "+quoted+" CASCADE")
	return err
}
