' Start PortView at login without opening a console window.
'
' Registered by scripts/install-startup.ps1, which puts a shortcut in the
' Startup folder pointing at this file. The Node.js executable is passed as
' the first argument so the login session does not have to rely on PATH.
Option Explicit

Dim shell, fso, root, node, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

node = "node"
If WScript.Arguments.Count > 0 Then
  If fso.FileExists(WScript.Arguments(0)) Then
    node = WScript.Arguments(0)
  End If
End If

' The server exits on its own when another copy is already serving the port.
command = """" & node & """ """ & root & "\server.js"" --startup"

shell.CurrentDirectory = root
shell.Run command, 0, False
