/**
 * 日本語の文言（キーの正本）。
 * ここに書いたキーが型になり、en.ts に同じキーが無いとビルドが通らない。
 * 画面を追加するたびに、この下にその画面のブロックを足していく。
 */
export const ja = {
  common: {
    appName: "化学物質管理システム",
    save: "保存",
    cancel: "キャンセル",
    delete: "削除",
    edit: "編集",
    view: "表示",
    search: "検索",
    create: "＋ 新規登録",
    open: "開く",
    close: "閉じる",
    back: "戻る",
    loading: "読み込み中...",
    processing: "処理中...",
    prev: "前へ",
    next: "次へ",
    totalCount: (n: number) => `全 ${n} 件`,
    pageOf: (page: number, total: number) => `${page} / ${total}`,
  },

  nav: {
    system: "システム",
    home: "ホーム",
    substances: "物質",
    products: "製品 / 原材料",
    laws: "法規制",
    links: "リンク",
    metalFactors: "金属換算係数",
    importExport: "TSV取込 / 出力",
    docTemplates: "ドキュメント生成",
    admin: "管理",
  },

  shell: {
    openMenu: "メニューを開く",
    closeMenu: "メニューを閉じる",
    signOut: "ログアウト",
    readOnly: "参照のみ",
    language: "言語",
    roles: {
      SYSTEM_ADMIN: "システム管理者",
      PRIVILEGED: "特権ユーザー",
      NON_PRIVILEGED: "非特権ユーザー",
    },
  },

  login: {
    description: "アカウントでログインしてください",
    email: "メールアドレス",
    password: "パスワード",
    totp: "認証コード（6桁）",
    submit: "ログイン",
    submitting: "ログイン中...",
    failed: "ログインできませんでした",
    mfaPrompt: "認証アプリのコードを入力してください",
  },

  changePassword: {
    title: "パスワード変更",
    description:
      "12文字以上で、英字と数字をそれぞれ1文字以上含めてください。変更すると他の端末のログインはすべて解除されます。",
    current: "現在のパスワード",
    next: "新しいパスワード",
    confirm: "新しいパスワード（確認）",
    submit: "変更する",
    submitting: "変更中...",
    failed: (status: number) => `変更できませんでした（${status}）`,
    done: "パスワードを変更しました。",
    toHome: "ホームへ",
  },

  home: {
    title: "ホーム",
    doneSoFar: "ここまでできていること",
    doneSoFarDesc: "機能を1つずつ確認しながら追加していきます。",
    itemAuth: "ログイン・ログアウト・パスワード変更",
    itemSidebar: "サイドバーの開閉（左上のボタン）",
    itemLanguage: "日本語 / English の切り替え",
  },

  /** サーバーが返すエラー（APIのレスポンス文言） */
  errors: {
    invalidJson: "リクエストボディがJSONではありません",
    validation: "入力内容に誤りがあります",
    invalidCredentials: "メールアドレスまたはパスワードが正しくありません",
    locked:
      "ログイン試行が続いたため一時的にロックされています。しばらく待ってから再試行してください",
    inactive: "このアカウントは利用できません。管理者にお問い合わせください",
    mfaInvalid: "認証コードが正しくありません",
    unauthorized: "ログインが必要です",
    forbiddenEdit: "編集権限がありません（参照・判定実行・ダウンロードのみ可能です）",
    forbiddenAdmin: "システム管理者のみ実行できます",
    noPassword: "パスワードが設定されていません。管理者にお問い合わせください",
    currentPasswordWrong: "現在のパスワードが正しくありません",
    loadFailed: (status: number) => `読み込みに失敗しました（${status}）`,
    saveFailed: (status: number) => `保存に失敗しました（${status}）`,
    deleteFailed: "削除に失敗しました",
  },

  /** 入力チェック（Zodスキーマが使う） */
  validation: {
    emailRequired: "メールアドレスは必須です",
    emailFormat: "メールアドレスの形式が正しくありません",
    passwordRequired: "パスワードは必須です",
    passwordMin: "パスワードは12文字以上にしてください",
    passwordMax: "パスワードが長すぎます",
    passwordNeedsLetter: "英字を1文字以上含めてください",
    passwordNeedsDigit: "数字を1文字以上含めてください",
    totpFormat: "6桁の数字を入力してください",
    currentPasswordRequired: "現在のパスワードは必須です",
    passwordMismatch: "新しいパスワードが一致しません",
    passwordSameAsCurrent: "現在のパスワードと同じものは使用できません",
  },
};

/** 辞書の型。en.ts はこの形に一致しなければならない */
export type Messages = typeof ja;
