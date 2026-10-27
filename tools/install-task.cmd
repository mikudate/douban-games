@echo off
rem Register the daily 09:00 task that refreshes the Douban played-games RSS.
rem Run this OUTSIDE the agent sandbox (double-click it, or run it in a normal terminal).
rem The paths contain no spaces, so /TR can take the plain path.
setlocal
set TASK=DoubanPlayedGamesFeed
set CMD=C:\Users\liny\Documents\deepseek-harness\default-workspace\tools\refresh-feed.cmd
schtasks /Create /TN "%TASK%" /TR "%CMD%" /SC DAILY /ST 09:00 /F
if %ERRORLEVEL% EQU 0 (
  echo.
  echo Registered task %TASK%, daily at 09:00.
  schtasks /Query /TN "%TASK%" /FO LIST
) else (
  echo.
  echo Failed with code %ERRORLEVEL%. Try again from an elevated prompt.
)
pause
endlocal
