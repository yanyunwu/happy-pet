package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"happy-pet/api/internal/config"
	"happy-pet/api/internal/database"
	"happy-pet/api/internal/game"
	"happy-pet/api/internal/httpapi"
	"happy-pet/api/internal/users"
)

func main() {
	migrateOnly := flag.Bool("migrate-only", false, "只执行数据库迁移，不启动 HTTP")
	migrationStatus := flag.Bool("migration-status", false, "只读查看数据库迁移状态")
	flag.Parse()
	if err := run(*migrateOnly, *migrationStatus); err != nil {
		slog.Error("API stopped", "error", err)
		os.Exit(1)
	}
}
func run(migrateOnly, migrationStatus bool) error {
	if migrateOnly && migrationStatus {
		return fmt.Errorf("不能同时选择多个运维操作")
	}
	shutdown, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(shutdown, 5*time.Minute)
	defer cancel()
	if migrationStatus {
		status, e := database.Status(ctx, cfg)
		if e != nil {
			return e
		}
		if status.Untracked {
			fmt.Println("现有数据库未登记迁移，启动时将先核验初始结构。")
		}
		if status.Version < 0 {
			fmt.Println("当前数据库版本：未登记")
		} else {
			fmt.Printf("当前数据库版本：%d\n", status.Version)
		}
		for _, item := range status.Migrations {
			state := "待执行"
			if item.Applied {
				state = "已执行"
			}
			fmt.Printf("%s  %s\n", state, item.Name)
		}
		return nil
	}
	db, migrations, err := database.Open(ctx, cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	slog.Info("数据库已就绪", "version", migrations.Version, "applied", migrations.Applied, "adopted", migrations.Adopted)
	if err := game.Seed(ctx, db); err != nil {
		return err
	}
	if migrateOnly {
		return nil
	}
	service := users.New(db, cfg.JWTSecret, &users.WechatClient{AppID: cfg.WechatAppID, Secret: cfg.WechatAppSecret})
	server := &http.Server{Addr: cfg.Addr, Handler: httpapi.New(service, cfg, slog.Default()), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	failures := make(chan error, 1)
	go func() { slog.Info("API listening", "address", cfg.Addr); failures <- server.ListenAndServe() }()
	select {
	case err := <-failures:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-shutdown.Done():
	}
	stop()
	drain, done := context.WithTimeout(context.Background(), 10*time.Second)
	defer done()
	return server.Shutdown(drain)
}
