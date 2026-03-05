; Inno Setup Script for HakoDesk
; Creates a Windows installer package

#define MyAppName "HakoDesk"
; Version can be overridden via command line: iscc /DAppVersion=1.2.3 setup.iss
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#define MyAppVersion AppVersion
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
OutputBaseFilename=HakoDesk-{#MyAppVersion}-Setup
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
procedure DeleteCredential(Target: String);
var
  ResultCode: Integer;
begin
  // keyring WinVaultKeyring stores as "service/username" target format
  Exec('cmdkey.exe', '/delete:' + Target, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  PyHakoDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if MsgBox('Would you like to completely remove your personal data and configuration files?' + #13#10 + #13#10 +
              'This includes cached messages, settings, and saved credentials.',
              mbConfirmation, MB_YESNO) = IDYES then
    begin
      // 1. Delete HakoDesk credentials from Windows Credential Manager
      //    keyring WinVaultKeyring uses "service/key" target format (slash, not colon)
      DeleteCredential('hakodesk/access_token');
      DeleteCredential('hakodesk/app_id');
      // Legacy keys from older versions
      DeleteCredential('hakodesk/config_json');
      DeleteCredential('hakodesk/config_chunks');
      Log('Removed HakoDesk credentials from Windows Credential Manager.');

      // 2. Delete PyHako per-service credentials (shared with CLI)
      //    PyHako SDK stores tokens as "pyhako/{service}" in keyring
      DeleteCredential('pyhako/hinatazaka46');
      DeleteCredential('pyhako/sakurazaka46');
      DeleteCredential('pyhako/nogizaka46');
      DeleteCredential('pyhako/yodel');
      Log('Removed PyHako service credentials from Windows Credential Manager.');

      // 3. Delete HakoDesk app data directory
      //    Contains: settings.json, search_index.db, logs/, credentials/
      DataDir := ExpandConstant('{localappdata}\hakodesk');
      if DirExists(DataDir) then
      begin
        if DelTree(DataDir, True, True, True) then
          Log('HakoDesk app data deleted: ' + DataDir)
        else
          MsgBox('Failed to delete application data. You may need to remove it manually at: ' + DataDir, mbError, MB_OK);
      end;

      // 4. Delete PyHako shared auth data directory
      //    Contains: browser session data (OAuth cookies, Playwright profile)
      //    Location: %APPDATA%\pyhako
      PyHakoDir := ExpandConstant('{userappdata}\pyhako');
      if DirExists(PyHakoDir) then
      begin
        if DelTree(PyHakoDir, True, True, True) then
          Log('PyHako auth data deleted: ' + PyHakoDir)
        else
          Log('Failed to delete PyHako auth data at: ' + PyHakoDir);
      end;
    end;
  end;
end;
