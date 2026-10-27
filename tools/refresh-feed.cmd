@echo off
rem Daily refresh of the "Douban played games" RSS feed.
rem Called by Windows Task Scheduler task DoubanPlayedGamesFeed.
rem Keep this file ASCII-only: cmd.exe reads .cmd in the OEM codepage.
setlocal
set ROOT=C:\Users\liny\Documents\deepseek-harness\default-workspace
set NODE=C:\Program Files\nodejs\node.exe
"%NODE%" "%ROOT%\tools\douban-played-games-feed.mjs" --user lyx030605 --out "%ROOT%\feeds\lyx030605\played-games.xml" --opml "%ROOT%\feeds\lyx030605\douban.opml" >> "%ROOT%\feeds\lyx030605\refresh.log" 2>&1
endlocal
