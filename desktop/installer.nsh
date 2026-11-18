; Scripts ajoutés à l'installeur NSIS généré par electron-builder.

; Désinstallation : retire le lancement au démarrage s'il était coché (sinon Windows garderait
; une entrée vers un programme supprimé). Le dossier %APPDATA%\kayn-sim (.env, réglages) est
; laissé en place : il contient ta configuration, à supprimer à la main si tu le souhaites.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "KaynSim"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "KaynSim"
!macroend
