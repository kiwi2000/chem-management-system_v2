import type { Messages } from "./ja";

/**
 * 英語の文言。
 * 型 Messages に縛られているため、ja.ts にキーを足してここに足し忘れるとビルドが失敗する。
 */
export const en: Messages = {
  common: {
    appName: "Chemical Substance Management",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    view: "View",
    search: "Search",
    create: "+ New",
    open: "Open",
    close: "Close",
    back: "Back",
    loading: "Loading...",
    processing: "Working...",
    prev: "Previous",
    next: "Next",
    totalCount: (n: number) => `${n} item${n === 1 ? "" : "s"}`,
    pageOf: (page: number, total: number) => `${page} / ${total}`,
  },

  nav: {
    system: "System",
    home: "Home",
    substances: "Substances",
    products: "Products / Materials",
    laws: "Regulations",
    links: "Links",
    metalFactors: "Metal conversion factors",
    importExport: "TSV import / export",
    docTemplates: "Documents",
    admin: "Administration",
  },

  shell: {
    openMenu: "Open menu",
    closeMenu: "Close menu",
    signOut: "Sign out",
    readOnly: "Read only",
    language: "Language",
    roles: {
      SYSTEM_ADMIN: "System administrator",
      PRIVILEGED: "Privileged user",
      NON_PRIVILEGED: "Standard user",
    },
  },

  login: {
    description: "Sign in with your account",
    email: "Email address",
    password: "Password",
    totp: "Authentication code (6 digits)",
    submit: "Sign in",
    submitting: "Signing in...",
    failed: "Could not sign in",
    mfaPrompt: "Enter the code from your authenticator app",
  },

  changePassword: {
    title: "Change password",
    description:
      "Use at least 12 characters including at least one letter and one digit. Changing your password signs you out of all other devices.",
    current: "Current password",
    next: "New password",
    confirm: "New password (confirm)",
    submit: "Change password",
    submitting: "Changing...",
    failed: (status: number) => `Could not change the password (${status})`,
    done: "Your password has been changed.",
    toHome: "Go to home",
  },

  home: {
    title: "Home",
    doneSoFar: "What works so far",
    doneSoFarDesc: "Features are added one at a time, each confirmed before moving on.",
    itemAuth: "Sign in, sign out, change password",
    itemSidebar: "Collapsible sidebar (button at top left)",
    itemLanguage: "Switching between Japanese and English",
  },

  errors: {
    invalidJson: "The request body is not valid JSON",
    validation: "Please check your input",
    invalidCredentials: "The email address or password is incorrect",
    locked: "Too many failed attempts. This account is temporarily locked; please try again later",
    inactive: "This account is not available. Please contact your administrator",
    mfaInvalid: "The authentication code is incorrect",
    unauthorized: "Please sign in",
    forbiddenEdit: "You do not have edit permission (you can view, run assessments and download)",
    forbiddenAdmin: "Only a system administrator can do this",
    noPassword: "No password has been set. Please contact your administrator",
    currentPasswordWrong: "The current password is incorrect",
    loadFailed: (status: number) => `Could not load the data (${status})`,
    saveFailed: (status: number) => `Could not save (${status})`,
    deleteFailed: "Could not delete",
  },

  validation: {
    emailRequired: "Email address is required",
    emailFormat: "Enter a valid email address",
    passwordRequired: "Password is required",
    passwordMin: "Use at least 12 characters",
    passwordMax: "The password is too long",
    passwordNeedsLetter: "Include at least one letter",
    passwordNeedsDigit: "Include at least one digit",
    totpFormat: "Enter 6 digits",
    currentPasswordRequired: "Current password is required",
    passwordMismatch: "The new passwords do not match",
    passwordSameAsCurrent: "The new password must differ from the current one",
  },
};
