package com.dhruvgoel.habitloop.wear

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.dhruvgoel.habitloop.shared.TimeFmt
import java.time.Duration
import java.time.LocalTime
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Vibrating reminder for habits due within 15 minutes, with Log now and Snooze 30 min actions. */
class ReminderWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val session: Session = Session.get(applicationContext)
        if (!session.isPaired) return Result.success()
        val today = try { session.authed { it.today() } } catch (e: Exception) { return Result.retry() }
        val only: String? = inputData.getString("activity_id")
        val now: LocalTime = LocalTime.now()
        val nm: NotificationManager = applicationContext.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel("habits", "Habit reminders", NotificationManager.IMPORTANCE_HIGH)
        channel.enableVibration(true)
        channel.vibrationPattern = longArrayOf(0, 300, 150, 300)
        nm.createNotificationChannel(channel)
        for (h in today) {
            if (h.status != null || (only != null && h.id != only)) continue
            val due: LocalTime = try { LocalTime.parse(h.preferredTime) } catch (e: Exception) { continue }
            val mins: Long = Duration.between(now, due).toMinutes()
            if (only == null && mins !in 0..15) continue
            fun action(act: String, code: Int): PendingIntent = PendingIntent.getBroadcast(
                applicationContext, h.id.hashCode() + code,
                Intent(applicationContext, ReminderActionReceiver::class.java).setAction(act).putExtra("id", h.id),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val n = NotificationCompat.Builder(applicationContext, "habits")
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(h.name)
                .setContentText("Due at " + TimeFmt.to12h(h.preferredTime))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVibrate(longArrayOf(0, 300, 150, 300))
                .addAction(0, "Log now", action("LOG", 1))
                .addAction(0, "Snooze 30 min", action("SNOOZE", 2))
                .build()
            try { NotificationManagerCompat.from(applicationContext).notify(h.id.hashCode(), n) } catch (e: SecurityException) { }
        }
        return Result.success()
    }

    companion object {
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "habit-reminders", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<ReminderWorker>(15, TimeUnit.MINUTES).build()
            )
        }
    }
}

class ReminderActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id: String = intent.getStringExtra("id") ?: return
        NotificationManagerCompat.from(context).cancel(id.hashCode())
        if (intent.action == "SNOOZE") {
            WorkManager.getInstance(context).enqueue(
                OneTimeWorkRequestBuilder<ReminderWorker>().setInitialDelay(30, TimeUnit.MINUTES)
                    .setInputData(workDataOf("activity_id" to id)).build()
            )
        } else {
            val pending = goAsync()
            CoroutineScope(Dispatchers.IO).launch {
                try { Session.get(context).authed { it.logActivity(id, "done") } } catch (e: Exception) { }
                pending.finish()
            }
        }
    }
}
