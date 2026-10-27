; Added to Tauri's installer (bundle.windows.nsis.installerHooks).
;
; The app adds Netherstone to Open with, the folder menu and the PATH when
; they're turned on in Settings (integrations.rs). The installer adds none of
; them; the uninstaller takes back whatever the app added. Keep the names here
; in step with integrations.rs.

; The header image sits on the right, as nsis-header.bmp is drawn for.
!define MUI_HEADERIMAGE_RIGHT

!define NETHERSTONE_CLASSES "Software\Classes"
!define NETHERSTONE_PROGID "Netherstone.Import"
!define NETHERSTONE_FOLDER_VERB "Netherstone"
!define NETHERSTONE_ENV_KEY "Environment"
!define /ifndef HWND_BROADCAST 0xffff
!define /ifndef WM_SETTINGCHANGE 0x001A

; Tauri's installer already declares StrLoc; the uninstaller needs its own.
${UnStrRep}

!macro NETHERSTONE_NO_OPEN_WITH EXT
  DeleteRegValue HKCU "${NETHERSTONE_CLASSES}\.${EXT}\OpenWithProgids" "${NETHERSTONE_PROGID}"
!macroend

; NSIS strings hold NSIS_MAX_STRLEN characters, so a PATH that doesn't fit is
; left alone rather than written back cut short.
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
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=500
    ${EndIf}
  ${EndIf}
!macroend

; This file is read before Tauri defines MAINBINARYNAME, so only the macro,
; filled in later, uses it.
!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro NETHERSTONE_NO_OPEN_WITH "md"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "txt"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "pdf"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "docx"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "html"
  DeleteRegKey HKCU "${NETHERSTONE_CLASSES}\${NETHERSTONE_PROGID}"
  DeleteRegKey HKCU "${NETHERSTONE_CLASSES}\Applications\${MAINBINARYNAME}.exe"
  DeleteRegKey HKCU "${NETHERSTONE_CLASSES}\Directory\shell\${NETHERSTONE_FOLDER_VERB}"
  DeleteRegKey HKCU "${NETHERSTONE_CLASSES}\Directory\Background\shell\${NETHERSTONE_FOLDER_VERB}"
  !insertmacro NETHERSTONE_REMOVE_FROM_PATH
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
