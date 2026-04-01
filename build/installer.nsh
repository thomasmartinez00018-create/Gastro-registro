; Suprimir warning 6040 — LangString no definido en tabla de idioma es_AR
; Esto evita que makensis trate el warning como error fatal
!suppresswarnings
!pragma warning disable 6040

; Definir strings faltantes para es_AR (11274) y en_US como fallback
LangString MUI_UNTEXT_WELCOME_INFO_TITLE ${LANG_SPANISH} "Bienvenido"
LangString MUI_UNTEXT_WELCOME_INFO_TITLE ${LANG_ENGLISH} "Welcome"
