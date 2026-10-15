# .mp4変換 — MOV → MP4（端末内処理）

## 構成
- ViteでHTTPS配信する静的サイト
- `@ffmpeg/ffmpeg` 0.12.15 + `@ffmpeg/core` 0.12.10（シングルスレッド版）
- `@ffmpeg/util` 0.12.2
- 動画をアップロードするAPIなし。FFmpegのJS/WASMはビルド時に `public/ffmpeg/` へコピーし同一サイトから配信

## 必要環境
Node.js 20以降推奨、npm、Windows PowerShell。

```powershell
npm install
npm run dev
```
PCで表示されたローカルURLを開いてテストします。iPadから同じWi-Fiで開くにはPCのファイアウォール設定が必要で、HTTPのままではWASMの挙動・セキュリティ条件が本番と異なる場合があります。最終確認はHTTPS公開後に行ってください。

## 本番ビルド
```powershell
npm run build
```
`dist/` をCloudflare Pagesへデプロイします。`public/ffmpeg/` が作られ、`dist/ffmpeg/ffmpeg-core.js` と `.wasm` が含まれることを確認してください。

## 制限
- 250MBを超える入力を拒否、100MB超は警告。成功を保証する上限ではありません。
- ffmpeg.wasmはファイルをメモリへ読み込んで仮想ファイルシステムへコピーするため、ストリーミング処理ではありません。入力・処理用バッファ・出力が重複し、実ファイルサイズより大きなメモリを使います。
- 成功した出力Blobは「変換済みデータを削除」またはページ終了までメモリに保持します。OPFS/IndexedDBには保存しません。
- HDR判定はFFmpegログに基づく簡易判定です。全HDR形式を確実に識別するものではありません。大切な動画は元データを保持し、出力を確認してください。
- iPadの機種・iPadOS・空きメモリ・入力コーデックによって失敗する場合があります。iPad実機検証済みを意味しません。

## ライセンス
ffmpeg.wasmパッケージとFFmpeg本体はそれぞれの同梱ライセンスを確認してください。FFmpegのビルド構成によってはLGPL/GPLの条件が異なります。再配布・公開前に `node_modules/@ffmpeg/ffmpeg` と `node_modules/@ffmpeg/core` のLICENSE/NOTICEを確認し、必要なライセンス文書をサイトに掲載してください。
