import { basename } from 'node:path';
import type { AppContext } from './app.js';
import { HttpError } from './app.js';
import { createBackup, isBackupRunning, readBackupStatus } from './backup.js';
import { mediaLimit, mediaUsage, freeSpace, cleanupMedia } from './media.js';

export function registerOperations(ctx: AppContext): void {
  const {app,db,requireAuth,requireWrite,assertProfile}=ctx;
  const configured = () => !!process.env.UZ_BACKUP_DIR && !!process.env.UZ_BACKUP_PASSPHRASE;
  const runBackup = () => createBackup({dataDir:db.dataDir,repositoryDir:process.env.UZ_BACKUP_DIR!,passphrase:process.env.UZ_BACKUP_PASSPHRASE!,database:db.raw,databaseFilename:basename(db.path)});
  app.get('/api/system',requireAuth,async(_req,res,next)=>{
    try{res.json({mediaBytes:mediaUsage(ctx),mediaLimitBytes:mediaLimit(),freeBytes:freeSpace(db.dataDir),lastBackup:await readBackupStatus(db.dataDir),backupConfigured:configured(),backupRunning:isBackupRunning(db.dataDir),version:'0.1.0'});}catch(e){next(e);}
  });
  app.post('/api/backup',requireWrite,async(req,res,next)=>{
    try{
      assertProfile(req,req.body.profileVersion);
      if(!configured())throw new HttpError(409,'Noch kein Sicherungsziel eingerichtet. Die Anleitung im Projektordner beschreibt die Einrichtung.','BACKUP_NOT_CONFIGURED');
      if(isBackupRunning(db.dataDir))throw new HttpError(409,'Eine Sicherung läuft bereits.','BACKUP_BUSY');
      res.json(await runBackup());
    }catch(e){next(e);}
  });
  const maintenance = async() => {
    try{
      await cleanupMedia(ctx);
      if(configured()&&!isBackupRunning(db.dataDir)){
        const status=await readBackupStatus(db.dataDir);
        if(!status.lastSuccess || Date.parse(status.lastSuccess.createdAt)<Date.now()-86_400_000)await runBackup();
      }
    }catch{console.error('Die Wartung oder Sicherung konnte nicht abgeschlossen werden. Bitte den Sicherungsstatus prüfen.');}
  };
  // Delayed first pass avoids delaying startup. Intervals never keep a stopped server alive.
  const startup=setTimeout(()=>void maintenance(),60_000);startup.unref();
  const timer=setInterval(()=>void maintenance(),3_600_000);timer.unref();
}
