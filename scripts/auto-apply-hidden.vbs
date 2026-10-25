' auto-apply-hidden.vbs -- run auto-apply.js with NO console window.
' Used by the scheduled task: wscript.exe "auto-apply-hidden.vbs"
' (0 = hidden, False = do not wait)
Dim fso, sh, here, script
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
script = here & "\auto-apply.js"
sh.Run "node """ & script & """", 0, False
