CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value)
VALUES ('announcement', jsonb_build_object('content',
    E'三种玩法，一起开玩\n经典三消、极限四消、趣味规则消现已开放\n\n一口气，连闯两关\n从第一关直接开始，过关后自动进入第二关\n\n森林木作，新装登场\n十二生肖和猫、熊猫、狮子，变身木雕小伙伴\n\n四种道具，帮你过关\n撤回、铲出、提示和顺时针转动重排'))
ON CONFLICT (key) DO NOTHING;
