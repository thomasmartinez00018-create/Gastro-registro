; ── installer.nsh ──────────────────────────────────────────────────────────
; Compatible con NSIS 3.0.4.x (electron-builder bundled version)
;
; Definir LangStrings que electron-builder / MUI2 puede requerir
; pero que no siempre están definidos para todos los idiomas.
; No usamos !suppresswarnings ni !pragma (requieren NSIS ≥3.03+).

; Fallback para cadenas MUI del desinstalador
LangString MUI_UNTEXT_WELCOME_INFO_TITLE ${LANG_ENGLISH} "Welcome"
