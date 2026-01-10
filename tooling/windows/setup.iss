; Inno Setup Script for HakoDesk
; Creates a Windows installer package

#define MyAppName "HakoDesk"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "xtorker"
#define MyAppURL "https://github.com/xtorker/Project-PyHako"
#define MyAppExeName "HakoDesk.exe"

[Setup]
; NOTE: The value of AppId uniquely identifies this application.
AppId={{A3522271-9654-4740-9854-3453457567}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
; Run without admin rights (install for current user only)
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=hakodesk-setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Source from PyInstaller output (HakoDesk folder)
Source: "..\..\dist\HakoDesk\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\dist\HakoDesk\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  ResultCode: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // Ask the user if they want to delete the data directory
    if MsgBox('Would you like to completely remove your personal data and configuration files?' + #13#10 + #13#10 +
              'This includes cached messages, settings, and saved credentials.',
              mbConfirmation, MB_YESNO) = IDYES then
    begin
      // 1. Delete credentials from Windows Credential Manager
      // Use cmdkey to remove stored credentials
      Exec('cmdkey.exe', '/delete:pymsg:access_token', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Exec('cmdkey.exe', '/delete:pymsg:app_id', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      // Legacy/chunk keys (in case they exist from older versions)
      Exec('cmdkey.exe', '/delete:pymsg:config_json', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Exec('cmdkey.exe', '/delete:pymsg:config_chunks', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Log('Removed credentials from Windows Credential Manager.');

      // 2. Delete the data directory
      DataDir := ExpandConstant('{localappdata}\pymsg');

      if DirExists(DataDir) then
      begin
        if DelTree(DataDir, True, True, True) then
          Log('Application data deleted successfully.')
        else
          MsgBox('Failed to delete application data. You may need to remove it manually at: ' + DataDir, mbError, MB_OK);
      end;
    end;
  end;
end;
