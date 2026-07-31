# README整備設計

## 目的

初めてrepositoryを開いた開発者が、プロジェクトの用途と技術構成を把握し、ローカル環境を構築して主要な検証を実行できるREADMEを用意する。Supabase公式Docker構成の更新入口と、破壊的操作に関する注意もREADMEから確認できるようにする。

## 情報の境界

`README.md`は開発の入口とし、次を簡潔に記載する。

- プロジェクト概要
- 主な技術構成
- 必要なホスト環境
- 初回セットアップの最短手順
- 開発・検証で頻繁に使うコマンド
- Supabase公式Docker構成を更新するwrapper
- ローカルDB破棄、checkout分離、Postgres 15非対応などの重要な注意

環境変数の検証条件、異常時の復旧手順、signalやlockの詳細は`docs/local-development.md`を正本とする。READMEへ逐語転記せず、必要な場面から該当文書へリンクする。

## 構成

READMEは次の順で構成する。

1. プロジェクト名と概要
2. 技術構成
3. ローカル開発の前提
4. 初回セットアップ
5. 日常的な開発と検証
6. Supabase構成の更新
7. 安全上の注意
8. 詳細ドキュメントへのリンク

コマンドは現在のwrapperと`package.json`を正本として記載する。ローカルstackの破壊や再作成には直接のCompose操作ではなく、`generate-local-secrets.sh`、`reset-local-db.sh`、`refresh-supabase.sh`、`run-e2e.sh`を案内する。

## 検証

- README内の主要コマンドと参照先が実在することをtooling testで検証する。
- Markdown formattingを`npm run format:check`で検証する。
- `git diff --check`で空白エラーがないことを確認する。

## 対象外

- アプリケーション機能の詳細仕様
- 本番環境へのデプロイ手順
- Supabase vendor更新処理の内部アルゴリズム
- 既存のローカル開発文書の全面的な再構成
