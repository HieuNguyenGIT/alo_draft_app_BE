@echo off
echo Stopping containers...
docker compose down

echo Creating volume if it doesn't exist...
docker volume create alo_draft_app_be_db-data

echo Restoring database...
docker run --rm -v alo_draft_app_be_db-data:/dbdata -v %cd%/database-backup:/backup alpine sh -c "rm -rf /dbdata/* && tar xzf /backup/db-data.tar.gz -C /dbdata"

echo Database restored successfully. You can now run 'docker compose up' to start the application.