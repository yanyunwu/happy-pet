package schema

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// PostgreSQL's PL/pgSQL EXECUTE uses an atomic SPI context. Transaction-control
// commands are rejected by PostgreSQL itself, including inside called routines;
// correctness does not depend on reproducing PostgreSQL's SQL lexer in Go.
func executeMigration(ctx context.Context, tx *sql.Tx, source string) error {
	outer := delimiter(source, "outer")
	inner := delimiter(source, "sql")
	_, err := tx.ExecContext(ctx, "DO "+outer+" BEGIN EXECUTE "+inner+"\n"+source+"\n"+inner+"; END; "+outer+";")
	return err
}

func delimiter(source, kind string) string {
	for i := 0; ; i++ {
		tag := fmt.Sprintf("$happy_pet_%s_%d$", kind, i)
		if !strings.Contains(source, tag) {
			return tag
		}
	}
}

// Only check whether a file contains a statement; PostgreSQL validates and
// executes its grammar. Leading SQL comments may be nested or CR/LF terminated.
func validateMigrationSQL(source string) error {
	for {
		source = strings.TrimSpace(source)
		if source == "" {
			return fmt.Errorf("迁移文件不能是空文件或只有注释")
		}
		if source[0] == ';' {
			source = source[1:]
			continue
		}
		if strings.HasPrefix(source, "--") {
			if end := strings.IndexAny(source, "\r\n"); end >= 0 {
				source = source[end:]
				continue
			}
			return fmt.Errorf("迁移文件不能只有注释")
		}
		if strings.HasPrefix(source, "/*") {
			depth, i := 1, 2
			for i < len(source) && depth > 0 {
				if strings.HasPrefix(source[i:], "/*") {
					depth++
					i += 2
				} else if strings.HasPrefix(source[i:], "*/") {
					depth--
					i += 2
				} else {
					i++
				}
			}
			if depth != 0 {
				return fmt.Errorf("SQL 注释未结束")
			}
			source = source[i:]
			continue
		}
		return nil
	}
}
