; Added to Tauri's installer (bundle.windows.nsis.installerHooks):
; - Netherstone in "Open with" for the files it imports, never as their
;   default app. Tauri's own fileAssociations would make it the default.
; - "Open as Netherstone vault" on folders.
; - The `netherstone` terminal command, by putting the app's bin folder (and
;   nothing else of the app) on the user's PATH.
; Uninstalling takes each of them back out.

!define NETHERSTONE_PROGID "Netherstone.Import"
!define NETHERSTONE_FOLDER_VERB "Netherstone"
!define /ifndef HWND_BROADCAST 0xffff
!define /ifndef WM_SETTINGCHANGE 0x001A

; This file is read before Tauri defines MAINBINARYNAME and PRODUCTNAME, so
; only the macros below, filled in later, use them.

; The user's PATH is changed in the registry directly, keeping %VAR% entries
; as written. NSIS strings hold NSIS_MAX_STRLEN characters, so a PATH that
; doesn't fit is left alone rather than written back cut short.
!define NETHERSTONE_ENV_KEY "Environment"
; Tauri's installer already declares StrLoc; the uninstaller needs its own.
${UnStrRep}

!macro NETHERSTONE_OPEN_WITH EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${NETHERSTONE_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
!macroend

!macro NETHERSTONE_NO_OPEN_WITH EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${NETHERSTONE_PROGID}"
!macroend

!macro NETHERSTONE_FOLDER_MENU KEY
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\${NETHERSTONE_FOLDER_VERB}" "" "Open as Netherstone vault"
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\${NETHERSTONE_FOLDER_VERB}" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\${NETHERSTONE_FOLDER_VERB}\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%V$\""
!macroend

!macro NETHERSTONE_PATH_CHANGED
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=500
!macroend

!macro NETHERSTONE_ADD_TO_PATH
  ReadRegStr $R0 HKCU "${NETHERSTONE_ENV_KEY}" "Path"
  StrLen $R1 "$R0;$INSTDIR\bin"
  ${StrLoc} $R2 ";$R0;" ";$INSTDIR\bin;" ">"
  ${If} $R2 == ""
  ${AndIf} $R1 < ${NSIS_MAX_STRLEN}
    ${If} $R0 == ""
      WriteRegExpandStr HKCU "${NETHERSTONE_ENV_KEY}" "Path" "$INSTDIR\bin"
    ${Else}
      WriteRegExpandStr HKCU "${NETHERSTONE_ENV_KEY}" "Path" "$R0;$INSTDIR\bin"
    ${EndIf}
    !insertmacro NETHERSTONE_PATH_CHANGED
  ${EndIf}
!macroend

!macro NETHERSTONE_REMOVE_FROM_PATH
  ReadRegStr $R0 HKCU "${NETHERSTONE_ENV_KEY}" "Path"
  StrLen $R1 ";$R0;"
  ${If} $R1 < ${NSIS_MAX_STRLEN}
    ${UnStrRep} $R2 ";$R0;" ";$INSTDIR\bin;" ";"
    ${If} $R2 != ";$R0;"
      ; Without the semicolons added around it.
      StrCpy $R2 $R2 "" 1
      StrCpy $R2 $R2 -1
      WriteRegExpandStr HKCU "${NETHERSTONE_ENV_KEY}" "Path" $R2
      !insertmacro NETHERSTONE_PATH_CHANGED
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${NETHERSTONE_PROGID}" "" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\${NETHERSTONE_PROGID}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\${NETHERSTONE_PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  !insertmacro NETHERSTONE_OPEN_WITH "md"
  !insertmacro NETHERSTONE_OPEN_WITH "pdf"
  !insertmacro NETHERSTONE_OPEN_WITH "docx"
  !insertmacro NETHERSTONE_OPEN_WITH "html"

  ; Right-click on a folder, and on the empty space inside one.
  !insertmacro NETHERSTONE_FOLDER_MENU "Directory"
  !insertmacro NETHERSTONE_FOLDER_MENU "Directory\Background"

  !insertmacro NETHERSTONE_ADD_TO_PATH

  ; Explorer picks up the new Open with entries now, not after a sign-in.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro NETHERSTONE_NO_OPEN_WITH "md"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "pdf"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "docx"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "html"
  DeleteRegKey SHCTX "Software\Classes\${NETHERSTONE_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\${NETHERSTONE_FOLDER_VERB}"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\${NETHERSTONE_FOLDER_VERB}"

  !insertmacro NETHERSTONE_REMOVE_FROM_PATH

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
