# PC再インストール前バックアップ一覧

作成日: 2026-07-17

この文書は、現在の開発環境をPC再インストール後に復元するための退避対象を整理する。秘密情報はGitへ追加せず、必要な場合だけ暗号化された保管先へ退避する。

## 1. Gitの状態

- リモート: `git@github.com:eigozatsudan/kondate.git`
- `main`: `64ae61e`。`origin/main` より4コミット先で、未push。
- 作業ブランチ: `codex/subagent-config`
- 作業ブランチHEAD: `d9a8881`
- `codex/subagent-config` にはupstreamがなく、現時点ではローカルのみ。
- 作業worktree: `/home/dev/projects/kondate/.worktrees/codex-subagent-config`
- 元checkoutにはユーザー所有の未コミット変更 `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md` があるため、再インストール前に別途退避する。
- この一覧と引継ぎ文書は、この文書を追加するコミットに含める。コミット後のHEADを再確認する。

コミットだけではPC障害から復元できない。再インストール前に、必要なローカルブランチをリモートへpushするか、`git bundle`を外部媒体へ退避すること。

## 2. Global設定で必ず退避するもの

| 優先度 | パス | 内容 | 取扱い |
| --- | --- | --- | --- |
| 必須 | `~/.codex/config.toml` | CodexのGlobal設定、モデル、MCP、multi-agent設定 | 通常の設定ファイルとして退避。値に秘密情報がないか確認する |
| 必須 | `~/.codex/agents/` | Globalカスタムエージェント定義 | ディレクトリ単位で退避 |
| 必須 | `~/.codex/rules/` | Global許可ルール | 再インストール後に内容を再確認してから復元 |
| 必須 | `~/.codex/skills/` | 手動追加したスキル | `.system`など再取得可能なものより、独自スキルを優先 |
| 必須 | `~/.bashrc`、`~/.profile` | shell設定、PATH、alias | シークレット直書きがないか確認する |
| 必須 | `~/.ssh/` | GitHub等のSSH鍵と設定 | **秘密情報**。暗号化媒体だけに退避し、権限を保持する |
| 条件付き | `~/.docker/` | Dockerログイン情報と設定 | **秘密情報を含み得る**。可能なら再ログインし、必要時のみ暗号化退避 |
| 条件付き | `~/.supabase/` | Supabase CLIの認証・状態 | **秘密情報を含み得る**。可能なら再ログインし、必要時のみ暗号化退避 |
| 条件付き | `~/.claude/`、`~/.claude.json` | 他AIツールのGlobal設定・状態 | 内容を精査し、再ログインを優先。必要時のみ暗号化退避 |
| 条件付き | `~/.copilot/`、`~/.gemini/` | 他AIツールの設定・認証・状態 | **秘密情報を含み得る**。利用継続時のみ暗号化退避 |
| 条件付き | `~/.aws`、`~/.azure` | クラウドCLIの設定・認証 | **秘密情報**。現在はWindows側へのsymlinkなので、リンクではなく参照先をWindows側の安全な方法で退避 |

現在の環境では `~/.gitconfig`、`~/.config/gh`、`~/.config/netlify`、`~/.config/Code/User` は存在を確認できなかった。別ユーザーや別環境に存在する場合は追加で退避する。

## 3. Codexの会話・作業状態を引き継ぐ場合

Codexを完全終了してから、次を同じ時点のスナップショットとして退避する。SQLite本体だけでなく、同名の `-wal` と `-shm` が存在する場合は一緒に扱う。

この節のデータには、会話、コマンド、ローカルパス、誤って入力した秘密値が含まれ得る。すべて機密データとして暗号化し、Gitや平文のクラウドストレージへ置かない。

- `~/.codex/sessions/`
- `~/.codex/history.jsonl`
- `~/.codex/memories_1.sqlite*`
- `~/.codex/goals_1.sqlite*`
- `~/.codex/state_5.sqlite*`
- 必要な場合のみ `~/.codex/logs_2.sqlite*`
- 必要な成果物がある場合のみ `~/.codex/generated_images/`

`~/.codex/auth.json` は認証情報であるため、原則として退避せず再ログインする。やむを得ず退避する場合は、SSH鍵と同等の秘密情報として暗号化する。

## 4. 再生成できるため通常は退避不要なもの

- `~/.codex/cache/`
- `~/.codex/packages/`
- `~/.codex/plugins/cache/`
- `~/.codex/models_cache.json`
- `~/.codex/version.json`
- `~/.codex/shell_snapshots/`
- Dockerのイメージ、build cache、停止中コンテナ
- `node_modules/`
- 生成可能なローカル用 `.env`

## 5. プロジェクト固有で確認するもの

- リポジトリにコミット済みの `.codex/config.toml` と `.codex/agents/*.toml`
- `AGENTS.md`、`SubAgents.md`、設計書、実装Plan
- Gitに含まれない `.env` や証明書。必要な実値がある場合だけ暗号化して別保管する
- SupabaseやNetlifyに登録済みの環境変数一覧。値はパスワードマネージャー等で管理し、この文書へ書かない
- ローカルDB内だけに存在する必要データ。開発用の再生成可能データなら退避しない

## 6. 再インストール直前の確認

1. `git status --short --branch` を全checkout/worktreeで確認し、modifiedとuntrackedをすべて一覧化する。
2. 必要なmodified/untrackedファイルをコミットするか、Gitとは別の暗号化した外部媒体へ退避する。`git bundle`とpushには未追跡ファイルが含まれない。
3. ローカルだけのブランチとコミットをリモートまたは暗号化した外部媒体へ退避する。
4. Global設定と必要なセッション状態を、秘密情報の区分に従って退避する。
5. バックアップ先からファイル一覧を読み返せることを確認する。
6. SSH秘密鍵、認証JSON、`.env` が通常のGit履歴や平文クラウドへ混入していないことを確認する。
