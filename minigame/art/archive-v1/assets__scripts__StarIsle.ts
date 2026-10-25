import { _decorator, Asset, AudioClip, AudioSource, BlockInputEvents, Camera, Canvas, Color, Component, Graphics, ImageAsset, Label,
    Layers, Node, Rect, ResolutionPolicy, Sprite, SpriteFrame, Texture2D, Tween, UIOpacity, UITransform, Vec3,
    director, profiler, resources, sys, tween, view } from 'cc';
import { CAPACITY, KIND_NAMES, LEVELS, MatchGame, TILE_H, TILE_W, Tile } from './core/MatchGame';
import * as P from './ui/Paint';

const { ccclass, property } = _decorator;
const C = P.PALETTE;
const SAVE_KEY = 'star-isle-v1';
interface SaveData { unlocked: number; completed: boolean; sound: boolean; best: number; }

@ccclass('StarIsle')
export class StarIsle extends Component {
    @property(Node)
    public stageRoot: Node | null = null;
    @property(Node)
    public homeRoot: Node | null = null;
    private stage!: Node;
    private screen!: Node;
    private effects!: Node;
    private board!: Node;
    private rack!: Node;
    private hud!: Node;
    private controls!: Node;
    private modal: Node | null = null;
    private toastNode: Node | null = null;
    private tileNodes = new Map<number, Node>();
    private frames: SpriteFrame[] = [];
    private hero!: SpriteFrame;
    private clips = new Map<string, AudioClip>();
    private audio!: AudioSource;
    private music!: AudioSource;
    private game: MatchGame | null = null;
    private busy = false;
    private playTime = 0;
    private currentScreen = 'home';
    private save: SaveData = { unlocked: 1, completed: false, sound: true, best: 0 };
    private soundButtons: Node[] = [];

    async onLoad(): Promise<void> {
        profiler.hideStats();
        view.setDesignResolutionSize(720, 1280, ResolutionPolicy.SHOW_ALL);
        try {
            const raw = JSON.parse(sys.localStorage.getItem(SAVE_KEY) || '{}');
            this.save = { unlocked: raw.unlocked === 2 ? 2 : 1, completed: !!raw.completed, sound: raw.sound !== false, best: Number(raw.best) || 0 };
        } catch { /* Unavailable or old storage should never prevent starting a game. */ }
        if (!this.stageRoot || !this.homeRoot) throw new Error('main.scene must bind Stage Root and Home Root to the authored Canvas hierarchy.');
        this.stage = this.stageRoot;
        const cameraNode = this.stage.parent!.getComponent(Canvas)!.cameraComponent!.node;
        this.audio = this.node.addComponent(AudioSource);
        this.music = cameraNode.addComponent(AudioSource); this.music.loop = true; this.music.volume = .22;
        this.screen = P.layer(this.stage, 'Loading');
        P.rounded(this.screen, 'background', 360, 640, 720, 1280, '#F4EDF9', 0);
        P.star(this.screen, 360, 550, 54, C.gold);
        P.text(this.screen, 'loading-title', '星屿正在醒来…', 360, 655, 28, C.deep, 600, true);
        const progress = P.text(this.screen, 'loading-progress', '收集一点点星光', 360, 710, 21, C.muted);
        try {
            const atlasImage = await this.load<ImageAsset>('art/items', ImageAsset);
            if (!this.isValid) return;
            const heroFrame = this.homeRoot.getChildByName('KeyArt')?.getComponent(Sprite)?.spriteFrame;
            if (!heroFrame) throw new Error('The HomePage/KeyArt SpriteFrame must be assigned in main.scene.');
            this.hero = heroFrame;
            const atlasTexture = new Texture2D(); atlasTexture.image = atlasImage;
            for (let i = 0; i < 9; i++) {
                const frame = new SpriteFrame(); frame.texture = atlasTexture;
                const x = Math.round(i % 3 * atlasImage.width / 3), y = Math.round(Math.floor(i / 3) * atlasImage.height / 3);
                const right = Math.round((i % 3 + 1) * atlasImage.width / 3), bottom = Math.round((Math.floor(i / 3) + 1) * atlasImage.height / 3);
                frame.rect = new Rect(x, y, right - x, bottom - y); this.frames.push(frame);
            }
            this.home();
            for (const sound of ['tap', 'match', 'win', 'lose', 'music']) {
                resources.load(`audio/${sound}`, AudioClip, (error, clip) => { if (!error && this.isValid) this.clips.set(sound, clip); });
            }
        } catch (error) {
            console.error('Could not load game art', error);
            progress.string = '素材加载失败，请重新打开游戏';
            P.button(this.screen, 'retry-loading', '重新加载', 360, 800, 260, 76, () => director.loadScene('main'), true);
        }
    }
    private load<T extends Asset>(path: string, type: any): Promise<T> {
        return new Promise((resolve, reject) => resources.load(path, type, (err, asset) => err ? reject(err) : resolve(asset as T)));
    }
    update(dt: number): void { if (this.currentScreen === 'game' && this.game?.status === 'playing' && !this.modal) this.playTime += dt; }
    private persist(): void { try { sys.localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch { /* Play remains available without persistence. */ } }
    private play(name: string): void { const clip = this.clips.get(name); if (clip && this.save.sound) this.audio.playOneShot(clip, name === 'tap' ? .35 : .65); }
    private startMusic(): void {
        if (!this.save.sound || this.music.playing) return;
        const clip = this.clips.get('music'); if (clip) { this.music.clip = clip; this.music.play(); }
    }
    private clearScreen(name: string): void {
        this.unscheduleAllCallbacks(); this.clearHighlights(); this.modal = null; this.toastNode = null; this.soundButtons = []; this.tileNodes.clear();
        this.stage.children.slice().forEach(n => { if (n !== this.homeRoot) { n.active = false; n.destroy(); } });
        this.homeRoot!.active = name === 'home';
        this.screen = name === 'home' ? this.homeRoot! : P.layer(this.stage, name); this.currentScreen = name; this.busy = false;
    }
    private home(): void {
        this.clearScreen('home'); this.game = null;
        // All home art, typography, buttons and layout live in main.scene.
        // Runtime only updates progress/sound state and adds transient particles.
        const welcome = this.homeRoot!.getChildByName('WelcomePanel')!;
        const chapter = welcome.getChildByName('Chapter2Button')!;
        chapter.getChildByName('Number')!.active = this.save.unlocked === 2;
        chapter.getChildByName('Lock')!.active = this.save.unlocked !== 2;
        chapter.getChildByName('Difficulty')!.getComponent(Label)!.string = this.save.unlocked === 2 ? '挑战 · 有点上头' : '挑战 · 通关后解锁';
        this.soundButtons.push(this.homeRoot!.getChildByName('SoundButton')!); this.refreshSoundButtons();
        this.effects = P.layer(this.stage, 'home-particles');
        for (let i = 0; i < 9; i++) {
            const x = 42 + (i * 83) % 640, y = 320 + (i * 117) % 470;
            const n = P.star(this.effects, x, y, 4 + i % 4, i % 2 ? C.white : '#FBE4A8', 165);
            tween(n).repeatForever(tween().to(2 + i * .14, { position: new Vec3(x + 10, -y + 18, 0) }).to(2 + i * .14, { position: new Vec3(x, -y, 0) })).start();
        }
        P.pop(welcome.getChildByName('StartButton')!, .12);
    }
    public onHomeStart(): void {
        if (this.frames.length !== 9 || this.modal) return;
        this.play('tap'); this.startLevel(1);
    }
    public onHomeChapter(_event: unknown, data: string): void {
        if (this.frames.length !== 9 || this.modal) return;
        const id = Number(data) === 2 ? 2 : 1;
        if (id > this.save.unlocked) { this.toast('先完成「初遇星屿」，再开启挑战吧'); return; }
        this.play('tap'); this.startLevel(id);
    }
    public onHomeHelp(): void { if (this.frames.length === 9 && !this.modal) this.showRules(); }
    public onHomeSound(): void { if (this.frames.length === 9 && !this.modal) this.toggleSound(); }
    private refreshSoundButtons(): void {
        this.soundButtons.filter(n => n.isValid).forEach(n => {
            const sound = n.getChildByName('icon-sound'), mute = n.getChildByName('icon-mute');
            if (sound) sound.active = this.save.sound; if (mute) mute.active = !this.save.sound;
        });
    }
    private toggleSound(): void {
        this.save.sound = !this.save.sound; this.persist();
        if (!this.save.sound) this.music.stop(); else { this.startMusic(); this.play('tap'); }
        this.refreshSoundButtons();
    }
    private soundButton(parent: Node, x: number, y: number): void {
        const b = P.button(parent, 'sound-toggle', '', x, y, 56, 56, () => this.toggleSound());
        P.icon(b, 'sound', 0, 0, 18, C.deep); P.icon(b, 'mute', 0, 0, 18, C.deep);
        this.soundButtons.push(b); this.refreshSoundButtons();
    }
    private startLevel(id: number, seed?: number): void {
        this.clearScreen('game'); this.game = new MatchGame(id, seed); this.playTime = 0; this.startMusic();
        P.rounded(this.screen, 'base', 360, 640, 720, 1280, '#F8F2FB', 0);
        const art = P.sprite(this.screen, 'dream-background', this.hero, 360, 540, 720, 1080); P.opacity(art, 42);
        P.rounded(this.screen, 'soft-board-base', 360, 644, 654, 624, '#FFFDF9', 38, '#FFFFFF', 155);
        const back = P.button(this.screen, 'pause', '', 66, 77, 58, 58, () => { if (!this.busy) this.showPause(); });
        P.icon(back, 'back', 0, 0, 20, C.deep); this.soundButton(this.screen, 654, 77);
        P.text(this.screen, 'chapter-number', `C H A P T E R  0${id}`, 360, 65, 17, C.muted, 410, true);
        P.text(this.screen, 'chapter-title', this.game.level.title, 360, 118, 39, C.ink, 500, true);
        P.text(this.screen, 'chapter-subtitle', this.game.level.subtitle, 360, 168, 21, C.muted, 600);
        this.hud = P.layer(this.screen, 'HUD'); this.updateHud();
        this.board = P.layer(this.screen, 'Board');
        if (id === 1) {
            P.text(this.board, 'tutorial-heading', '选三枚一样的，试试看', 360, 411, 28, C.deep, 600, true);
            P.star(this.board, 149, 411, 11, C.gold); P.star(this.board, 571, 411, 11, C.gold);
            P.text(this.board, 'tutorial-footer', '不用移动位置，也不需要相邻哦', 360, 841, 22, C.muted);
        }
        this.buildBoard();
        P.rounded(this.screen, 'tray-shell', 360, 1023, 650, 118, '#E9DEF6', 26, '#D9C9ED', 255, true);
        for (let i = 0; i < CAPACITY; i++) P.rounded(this.screen, `slot-${i}`, 105 + i * 85, 1023, 76, 84, '#F9F5FD', 16, '#DED1ED');
        this.rack = P.layer(this.screen, 'Tray');
        this.controls = P.layer(this.screen, 'Tools'); this.updateControls();
        P.text(this.screen, 'game-footer', '收集星光，也给自己一点放空的时间', 360, 1239, 18, C.muted);
        this.effects = P.layer(this.stage, 'effects');
        if (id === 1) this.scheduleOnce(() => this.highlight(this.game!.availableTiles().filter(t => t.kind === 0).slice(0, 3).map(t => t.id), false), .35);
        else this.toast('迷雾开启！先观察下层，再决定收哪一枚');
    }
    private updateHud(): void {
        this.hud.children.slice().forEach(n => { n.active = false; n.destroy(); });
        const game = this.game!;
        P.rounded(this.hud, 'progress-card', 360, 244, 640, 100, C.cream, 26, '#EEE3F5', 247);
        P.text(this.hud, 'remaining-label', '待收集', 108, 222, 18, C.muted, 100);
        P.text(this.hud, 'remaining-number', String(game.remaining), 108, 260, 32, C.deep, 100, true);
        P.text(this.hud, 'progress-label', '星光收集进度', 285, 224, 20, C.ink, 230, false, 'left');
        P.text(this.hud, 'progress-number', `${game.cleared} / ${game.level.total}`, 578, 224, 20, C.muted, 130, false, 'right');
        P.rounded(this.hud, 'progress-track', 414, 261, 456, 13, '#ECE4F5', 6);
        const width = 456 * game.cleared / game.level.total;
        if (width > 0) P.rounded(this.hud, 'progress-fill', 186 + width / 2, 261, width, 13, '#B79AE2', Math.min(6, width / 2));
        P.text(this.hud, 'board-instruction', game.level.id === 1 ? '点击星物 → 放入收纳槽 → 三个相同自动消除' : '亮色星物可以收集 · 被盖住的要等上层移开', 360, 320, 20, C.muted, 670);
        P.text(this.hud, 'tray-label', '星光收纳槽', 147, 934, 22, C.ink, 210, true, 'left');
        P.text(this.hud, 'tray-count', `${game.tray.length} / 7`, 627, 934, 22, game.tray.length >= 5 ? C.danger : C.deep, 100, true, 'right');
        if (game.tray.length >= 5) P.text(this.hud, 'tray-warning', game.tray.length === 6 ? '最后一个空位，小心选择！' : '空位不多了，优先凑齐', 393, 934, 18, C.danger, 300);
        else P.text(this.hud, 'tray-tip', '凑齐三个，就能腾出空位', 397, 934, 18, C.muted, 300);
    }
    private buildBoard(): void {
        this.tileNodes.clear();
        this.game!.tiles.filter(t => !t.removed).forEach(tile => {
            const n = this.makeTile(this.board, tile, 360 + tile.x, 620 + tile.y);
            n.name = `tile-${tile.id}`;
            n.on(Node.EventType.TOUCH_END, () => this.pick(tile.id));
            this.tileNodes.set(tile.id, n);
        });
        this.syncBoard();
    }
    private makeTile(parent: Node, tile: Tile, x: number, y: number, scale = 1): Node {
        const n = P.rounded(parent, `star-item-${tile.id}`, x, y, TILE_W, TILE_H, '#FFFEF7', 15, '#D8C8E7', 255, true);
        const g = n.getComponent(Graphics)!; g.fillColor = P.color('#EEE4F5');
        g.roundRect(-TILE_W / 2 + 3, -TILE_H / 2 + 2, TILE_W - 6, 12, 5); g.fill();
        P.sprite(n, 'item-art', this.frames[tile.kind], 0, -3, 82, 82);
        n.setScale(scale, scale, 1); return n;
    }
    private syncBoard(): void {
        for (const [id, n] of this.tileNodes) {
            if (this.game!.tiles[id].removed) { n.active = false; n.destroy(); this.tileNodes.delete(id); continue; }
            const old = n.getChildByName('covered'); if (old) { old.active = false; old.destroy(); }
            const open = this.game!.isAvailable(id);
            if (!open) P.rounded(n, 'covered', 0, 0, TILE_W, TILE_H, '#7A6994', 15, undefined, 80);
        }
    }
    private renderTray(ids = this.game!.tray): void {
        this.rack.children.slice().forEach(n => { n.active = false; n.destroy(); });
        ids.forEach((id, index) => { const n = this.makeTile(this.rack, this.game!.tiles[id], 105 + index * 85, 1023, .92); n.name = `tray-${id}`; });
    }
    private pick(id: number): void {
        if (this.busy || this.modal || this.game?.status !== 'playing') return;
        if (!this.game.isAvailable(id)) { this.toast('这枚星物被盖住啦，先收集上面的'); return; }
        const result = this.game.pick(id); if (!result) return;
        this.busy = true; this.play('tap'); this.clearHighlights(); this.syncBoard();
        this.renderTray(result.displayTray);
        const target = this.rack.getChildByName(`tray-${id}`); if (target) target.active = false;
        const flying = this.makeTile(this.effects, result.tile, 360 + result.tile.x, 620 + result.tile.y);
        tween(flying).to(.22, { position: new Vec3(105 + result.insertion * 85, -1023, 0), scale: new Vec3(.92, .92, 1) }, { easing: 'quadOut' }).call(() => {
            flying.destroy(); if (target?.isValid) target.active = true;
            if (result.matched.length) {
                this.play('match');
                result.matched.forEach(mid => {
                    const n = this.rack.getChildByName(`tray-${mid}`);
                    if (n) { this.burst(n.position.x, 1023, 7); tween(n).to(.13, { scale: new Vec3(1.08, 1.08, 1) }).to(.13, { scale: new Vec3(.1, .1, 1) }).start(); tween(P.opacity(n, 255)).delay(.13).to(.13, { opacity: 0 }).start(); }
                });
                this.scheduleOnce(() => this.finishPick(), .29);
            } else this.finishPick();
        }).start();
    }
    private finishPick(): void {
        this.renderTray(); this.updateHud(); this.updateControls(); this.busy = false;
        if (this.game!.status === 'won') {
            this.save.unlocked = 2;
            if (this.game!.level.id === 2) this.save.completed = true;
            this.save.best = Math.max(this.save.best, this.game!.score); this.persist();
            this.scheduleOnce(() => this.showResult(true), .3);
        } else if (this.game!.status === 'lost') this.scheduleOnce(() => this.showResult(false), .2);
    }
    private updateControls(): void {
        this.controls.children.slice().forEach(n => { n.active = false; n.destroy(); });
        const game = this.game!;
        const tool = (x: number, type: string, label: string, left: number, callback: () => void, enabled: boolean) => {
            const b = P.button(this.controls, `tool-${type}`, '', x, 1159, 192, 94, () => {
                if (this.busy || this.modal || game.status !== 'playing') return;
                if (!enabled) { this.toast(left === 0 ? `${label}次数用完啦` : '先收集一枚星物再试试'); return; }
                this.play('tap'); callback();
            });
            P.icon(b, type, -57, 0, 25, enabled ? C.deep : '#B5A9C4');
            P.text(b, 'label', label, 20, -15, 24, enabled ? C.ink : '#B5A9C4', 100, true);
            P.text(b, 'count', `剩余 ${left} 次`, 20, 19, 17, C.muted, 120);
        };
        tool(143, 'undo', '撤回', game.undoLeft, () => this.undo(), game.canUndo);
        tool(360, 'shuffle', '重排', game.shuffleLeft, () => this.reshuffle(), game.shuffleLeft > 0);
        tool(577, 'hint', '提示', game.hintLeft, () => {
            const ids = game.hint();
            if (ids.length) { this.highlight(ids); this.updateControls(); this.toast('试试发光的星物，优先凑成一组'); }
            else this.toast('没有安全的推荐了，试试撤回或重排');
        }, game.hintLeft > 0);
    }
    private undo(): void {
        if (!this.game!.undo()) return;
        this.closeModal();
        this.board.children.filter(n => n.name.startsWith('tile-')).forEach(n => { n.active = false; n.destroy(); });
        this.buildBoard(); this.renderTray(); this.updateHud(); this.updateControls(); this.toast('刚才那一步，已经撤回啦');
    }
    private reshuffle(): void {
        if (!this.game!.reshuffle()) return;
        this.board.children.filter(n => n.name.startsWith('tile-')).forEach(n => { n.active = false; n.destroy(); });
        this.buildBoard(); this.renderTray(); this.updateHud(); this.updateControls(); this.toast('槽里的星物回到棋盘啦，重新出发！');
        for (const n of this.tileNodes.values()) P.pop(n, .03);
    }
    private highlight(ids: number[], timed = true): void {
        this.clearHighlights();
        ids.forEach(id => {
            const n = this.tileNodes.get(id); if (!n) return;
            const glow = P.rounded(n, 'hint-glow', 0, 0, TILE_W + 5, TILE_H + 5, '#FFF0A8', 17, '#EAC161', 58);
            const o = P.opacity(glow, 255); tween(o).repeatForever(tween().to(.6, { opacity: 80 }).to(.6, { opacity: 255 })).start();
        });
        if (timed) this.scheduleOnce(() => this.clearHighlights(), 4);
    }
    private clearHighlights(): void {
        this.tileNodes.forEach(n => { const glow = n.getChildByName('hint-glow'); if (glow) { const alpha = glow.getComponent(UIOpacity); if (alpha) Tween.stopAllByTarget(alpha); glow.active = false; glow.destroy(); } });
    }
    private burst(x: number, y: number, count = 10): void {
        for (let i = 0; i < count; i++) {
            const a = Math.PI * 2 * i / count; const d = 30 + i % 3 * 16;
            const n = P.star(this.effects, x, y, 6 + i % 3, [C.gold, C.pink, '#B6DBC5'][i % 3]);
            tween(n).to(.5, { position: new Vec3(x + Math.cos(a) * d, -y + Math.sin(a) * d, 0), scale: new Vec3(.1, .1, 1) }).call(() => n.destroy()).start();
        }
    }
    private overlay(name: string): Node {
        this.closeModal();
        const root = P.layer(this.stage, name); this.modal = root;
        const backdrop = P.rounded(root, 'modal-backdrop', 360, 640, 720, 1280, '#443257', 0, undefined, 158);
        backdrop.addComponent(BlockInputEvents);
        return root;
    }
    private closeModal(): void { if (this.modal?.isValid) { this.modal.active = false; this.modal.destroy(); } this.modal = null; }
    private showRules(): void {
        this.play('tap'); const m = this.overlay('Rules');
        P.rounded(m, 'rules-card', 360, 640, 610, 760, C.cream, 38, '#FFFFFF', 255, true);
        P.text(m, 'rules-title', '星光收集指南', 360, 338, 36, C.ink, 550, true);
        const close = P.button(m, 'close-rules', '', 607, 317, 44, 44, () => this.closeModal()); P.icon(close, 'close', 0, 0, 16, C.muted);
        [0, 1, 2].forEach(i => this.makeTile(m, { id: i, kind: 0, x: 0, y: 0, layer: 0, removed: false }, 260 + i * 100, 440));
        const rules = [
            ['01', '点亮色的星物', '它会自动进入下方的收纳槽。'],
            ['02', '三个相同，一起消除', '不需要相邻；被盖住的星物暂时不能点。'],
            ['03', '留意你的 7 个空位', '槽位装满且无法消除时，本次挑战结束。'],
        ];
        rules.forEach((rule, i) => {
            const y = 565 + i * 112;
            P.rounded(m, `rule-${i}`, 129, y, 48, 48, i === 1 ? C.mint : C.lavender, 16);
            P.text(m, 'rule-number', rule[0], 129, y, 20, C.deep, 45, true);
            P.text(m, 'rule-title', rule[1], 380, y - 12, 25, C.ink, 415, true, 'left');
            P.text(m, 'rule-detail', rule[2], 380, y + 25, 19, C.muted, 415, false, 'left');
        });
        P.button(m, 'understood', '知道啦，出发！', 360, 934, 480, 78, () => { this.closeModal(); this.play('tap'); }, true);
    }
    private showPause(): void {
        this.play('tap'); const m = this.overlay('Pause');
        P.rounded(m, 'pause-card', 360, 640, 580, 530, C.cream, 36, '#FFFFFF');
        P.sprite(m, 'cat', this.frames[6], 360, 451, 120, 120);
        P.text(m, 'pause-title', '休息一下，也没关系', 360, 548, 31, C.ink, 520, true);
        P.button(m, 'continue', '继续收集', 360, 650, 462, 78, () => this.closeModal(), true);
        P.button(m, 'restart', '重新挑战这一关', 360, 749, 462, 72, () => this.startLevel(this.game!.level.id));
        P.text(m, 'return-label', '返回星屿首页', 360, 844, 23, C.muted, 420).node.on(Node.EventType.TOUCH_END, () => this.home());
    }
    private showResult(won: boolean): void {
        const game = this.game!; this.play(won ? 'win' : 'lose');
        const m = this.overlay(won ? 'Victory' : 'TryAgain');
        P.rounded(m, 'result-card', 360, 644, 608, 766, C.cream, 40, '#FFFFFF', 255, true);
        P.rounded(m, 'result-medallion', 360, 368, 148, 148, won ? '#FFF0C9' : C.lavender, 74);
        P.sprite(m, 'result-icon', this.frames[won ? 0 : 6], 360, 363, 132, 132);
        if (won) { P.star(m, 241, 383, 16, C.gold); P.star(m, 481, 355, 13, C.pink); }
        P.text(m, 'result-eyebrow', won ? 'S T A R S  C O L L E C T E D' : 'T A K E  A  L I T T L E  B R E A K', 360, 478, 16, C.muted, 560, true);
        P.text(m, 'result-title', won ? game.level.id === 1 ? '第一站，轻松拿下！' : '你点亮了整片星海！' : '口袋装满啦', 360, 535, 36, C.ink, 560, true);
        P.text(m, 'result-subtitle', won ? game.level.id === 1 ? '准备好了吗？下一站可没这么简单。' : '两关全部完成，今天的星光属于你。' : '先凑齐已有的星物，再收集新种类。', 360, 588, 22, C.muted, 560);
        P.rounded(m, 'stats', 360, 682, 500, 112, '#F3EDF9', 24);
        const seconds = Math.floor(this.playTime);
        const stats = [['收集星物', `${game.cleared}`], ['消除组数', `${game.matches}`], ['本次用时', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`]];
        stats.forEach(([name, value], i) => { P.text(m, 'stat-name', name, 194 + i * 166, 654, 18, C.muted, 150); P.text(m, 'stat-value', value, 194 + i * 166, 697, 30, C.deep, 150, true); });
        const canUndo = !won && game.canUndo;
        const label = won ? game.level.id === 1 ? '挑战第二关' : '再游一次星海' : canUndo ? '撤回一步，继续挑战' : '重新挑战';
        P.button(m, 'result-primary', label, 360, 816, 500, 84, () => {
            if (canUndo) this.undo(); else this.startLevel(won && game.level.id === 1 ? 2 : game.level.id);
        }, true, 28);
        P.button(m, 'result-home', '返回首页', 360, 918, 500, 74, () => this.home(), false, 25);
        if (won) {
            for (let i = 0; i < 22; i++) {
                const x = 75 + (i * 91) % 570, y = 200 + (i * 43) % 250;
                const n = P.star(m, x, y, 7 + i % 5, [C.gold, C.pink, '#ACD8C4', '#BBA0E1'][i % 4]);
                tween(n).to(2 + i % 3 * .4, { position: new Vec3(x + (i % 2 ? 35 : -35), -y - 480, 0), angle: i % 2 ? 180 : -180 }).call(() => n.destroy()).start();
            }
        }
    }
    private toast(message: string): void {
        if (this.toastNode?.isValid) { this.toastNode.active = false; this.toastNode.destroy(); }
        const n = P.rounded(this.stage, 'toast', 360, this.currentScreen === 'home' ? 790 : 1102, 640, 54, '#645279', 20, undefined, 239);
        P.text(n, 'toast-text', message, 0, 0, 20, '#FFFFFF', 612);
        this.toastNode = n; const o = P.opacity(n, 255);
        tween(o).delay(2.6).to(.3, { opacity: 0 }).call(() => { if (n.isValid) n.destroy(); if (this.toastNode === n) this.toastNode = null; }).start();
    }
    onDestroy(): void { this.music?.stop(); this.unscheduleAllCallbacks(); }
}
