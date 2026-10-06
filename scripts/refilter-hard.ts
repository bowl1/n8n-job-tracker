import { db } from '../src/db.js';
import { absoluteExclusions } from '../src/services/jobDiscoveryService.js';
let count = 0;
try {
  const rows = (await db.query("SELECT id,title,description,fit_score,status,external_job_id,filter_reasons FROM jobs WHERE status NOT IN ('filtered_out','approved_to_apply','skipped')")).rows;
  for (const job of rows) {
    const exclusions = absoluteExclusions(job);
    if (!exclusions.length) continue;
    const client = await db.connect();
    let locked = false;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`job-${job.external_job_id}`])).rows[0].locked;
      if (!locked) throw new Error('Job still being processed; rerun after discovery finishes');
      await client.query('BEGIN');
      await client.query("UPDATE jobs SET status='filtered_out',filter_reasons=$2,updated_at=NOW() WHERE id=$1",[job.id,JSON.stringify([...job.filter_reasons ?? [],...exclusions])]);
      await client.query("INSERT INTO job_events(job_id,event_type,payload) VALUES ($1,'refiltered',$2)",[job.id,JSON.stringify({passes:false,reasons:exclusions})]);
      await client.query('COMMIT');
      count++;
    } catch(error) {await client.query('ROLLBACK');throw error;}
    finally {if(locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))',[`job-${job.external_job_id}`]);client.release();}
  }
  console.log(JSON.stringify({newlyExcluded:count}));
} finally {await db.end();}
