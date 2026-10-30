#ifndef SourceDir
  #error SourceDir is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif

[Setup]
AppId={{868A346F-0EB0-47B6-A851-E7C19DEFA426}
AppName=Slop Grenade
AppVersion={#AppVersion}
AppPublisher=threadkeeper
AppPublisherURL=https://github.com/threadkeeper/slop-grenade
DefaultDirName={localappdata}\SlopGrenade
DefaultGroupName=Slop Grenade
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=slop-grenade-windows-x64-setup
LicenseFile={#SourceDir}\LICENSE
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
Uninstallable=yes
UninstallDisplayIcon={app}\bin\slop-grenade-overlay.exe
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"

[Files]
Source: "{#SourceDir}\bin\slop-grenade.exe"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "{#SourceDir}\bin\slop-grenade-overlay.exe"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "{#SourceDir}\web\build\*"; DestDir: "{app}\web\build"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Slop Grenade"; Filename: "{app}\bin\slop-grenade-overlay.exe"; WorkingDir: "{app}\bin"
Name: "{autodesktop}\Slop Grenade"; Filename: "{app}\bin\slop-grenade-overlay.exe"; WorkingDir: "{app}\bin"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "SlopGrenade"; Flags: dontcreatekey uninsdeletevalue

[Run]
Filename: "{app}\bin\slop-grenade-overlay.exe"; Description: "Launch Slop Grenade"; WorkingDir: "{app}\bin"; Flags: nowait postinstall skipifsilent
