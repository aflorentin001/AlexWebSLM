@echo off
echo Running Git Push Script for DrLeeWebSLM
echo ==========================================

echo Setting up remotes...
git remote remove origin 2>nul
git remote remove upstream 2>nul
git remote add origin https://github.com/aflorentin001/AlexWebSLM.git
git remote add upstream https://github.com/fenago/drleewebslm.git

echo 
echo Checking current status...
git status

echo 
echo Adding all files except those in .gitignore...
git add .

echo 
echo Committing changes...
set /p commit_msg="Enter commit message (or press Enter for default message): "
if "%commit_msg%"=="" (
    git commit -m "Fixed TypeScript errors and added Google Analytics integration"
) else (
    git commit -m "%commit_msg%"
)

echo 
echo Choose push destination:
echo 1. Push to your fork (origin)
echo 2. Push to original repository (upstream) - requires permissions
set /p choice="Enter choice (1 or 2): "

if "%choice%"=="1" (
    echo Pushing to your fork: https://github.com/aflorentin001/AlexWebSLM
    git push -u origin main
) else if "%choice%"=="2" (
    echo WARNING: Pushing to upstream requires write permissions!
    set /p confirm="Are you sure? (Y/N): "
    if /I "%confirm%"=="Y" (
        git push -u upstream main
    ) else (
        echo Push cancelled.
    )
) else (
    echo Invalid choice. Defaulting to push to your fork.
    git push -u origin main
)

echo.
echo Done!
echo ==========================================