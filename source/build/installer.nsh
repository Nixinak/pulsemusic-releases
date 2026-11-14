; The installer sets up everything, the AI DJ included: after copying the app it downloads the
; DJ's voice (about 330 MB) and brain (about 2 GB), with progress shown in the details list.
; Included by electron-builder (nsis.include in electron-builder.yml).
; Silent installs (automatic updates) skip it; the app then finishes anything missing in the
; background.
!include LogicLib.nsh

!macro customInstall
  ${IfNot} ${Silent}
    SetDetailsView show
    DetailPrint "Setting up the AI DJ (about 2.3 GB). This takes a few minutes..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\setup-ai.ps1"'
    Pop $0
    ${If} $0 != 0
      DetailPrint "The AI DJ didn't finish downloading. Pulse Music will finish it in the background."
    ${Else}
      DetailPrint "Everything is ready."
    ${EndIf}
  ${EndIf}
!macroend
