# v0.99.2 試作環境・レビュー対応

- 試作PWA: https://tokky0117.github.io/household-pwa/previews/preview-v99-household-first/
- 試作GAS編集: https://script.google.com/home/projects/1I0l8OgHv2Mi9LhgAKpL-VGrpG2VJiTLhZMwuFDUtz6urddO2Gg3Ud0ci/edit
- 試作GASは既存デプロイIDと所有関係を確認して更新。移行済みフラグがなければ公開更新を停止。
- v99.1からv99.2へのシート移行不要。列・ID・既存サブ情報を保持。
- 新規日用品はcategory_id=4。全日用品の表示名で重複判定。旧sub_name付きの日用品は表示名を維持し、明示的に編集すると単一名称に統合。
- 古い操作の再送に備え、旧カテゴリ指定のitem.reorderは互換契約として維持。通常UIは全体並び替えのみ。
- v98固有の余剰列と自動生成商品は、利用履歴を確認せず削除しない。
- 本番移行は別途、本番データのバックアップ、カテゴリ別順序の全体順序化、未同期操作確認、公開用ビルドの試作接続除外が必要。本番を変更しない。
