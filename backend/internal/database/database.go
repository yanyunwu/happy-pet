// Package database opens the application store and prepares its schema before
// any HTTP listener is started, matching the reference project's startup flow.
package database

import (
	"context"
	"database/sql"
	"fmt"

	"happy-pet/api/internal/config"
	"happy-pet/api/internal/users"
	schema "happy-pet/api/sql"
)

func Open(ctx context.Context, cfg config.Config) (*sql.DB, schema.Result, error) {
	db, err := users.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, schema.Result{}, fmt.Errorf("数据库连接失败，请检查数据库服务和连接配置")
	}
	runner, err := schema.Default()
	if err != nil {
		db.Close()
		return nil, schema.Result{}, err
	}
	result, err := runner.Apply(ctx, db, func(ctx context.Context, tx *sql.Tx, fresh bool) error {
		service := users.New(db, cfg.JWTSecret, nil)
		service.Q = service.Q.WithTx(tx)
		if !fresh {
			admins, e := service.Q.CountAllAdmins(ctx)
			if e != nil {
				return e
			}
			if admins == 0 {
				return fmt.Errorf("已有数据库缺少管理员，迁移已停止")
			}
			return nil
		}
		if cfg.AdminUsername == "" || cfg.AdminPassword == "" {
			return fmt.Errorf("首次初始化需要设置 ADMIN_USERNAME 和 ADMIN_PASSWORD")
		}
		_, e := service.Create(ctx, users.CreateInput{Username: cfg.AdminUsername, Password: cfg.AdminPassword, Nickname: "管理员"}, "admin")
		return e
	})
	if err != nil {
		db.Close()
		return nil, schema.Result{}, fmt.Errorf("准备数据库失败：%w", err)
	}
	return db, result, nil
}

func Status(ctx context.Context, cfg config.Config) (schema.Status, error) {
	db, err := users.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return schema.Status{}, fmt.Errorf("数据库连接失败，请检查数据库服务和连接配置")
	}
	defer db.Close()
	runner, err := schema.Default()
	if err != nil {
		return schema.Status{}, err
	}
	return runner.Status(ctx, db)
}
