package dev.llmat.badminton

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.lifecycleScope
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.reflect.KClass
import kotlinx.coroutines.launch

private const val PROVIDER = "com.google.android.apps.healthdata"

/**
 * Test build: for a time the tester picks (an evening of badminton), shows what Health Connect
 * holds — active calories, total calories and exercise sessions, and which app wrote them — so
 * we learn what each kind of watch gives us before building the real app. Nothing leaves the phone.
 */
class MainActivity : ComponentActivity() {
    private val permissions = setOf(
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
    )

    private val zone: ZoneId = ZoneId.systemDefault()
    private var date: LocalDate = LocalDate.now()
    private var from: LocalTime = LocalTime.now().minusHours(3).withMinute(0).withSecond(0).withNano(0)
    private var to: LocalTime = LocalTime.now().withSecond(0).withNano(0)

    private lateinit var dateButton: Button
    private lateinit var fromButton: Button
    private lateinit var toButton: Button
    private lateinit var output: TextView

    private val askPermissions =
        registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
            if (granted.isEmpty()) show("没有拿到权限。请在 Health Connect 里允许这个 App 读取。\nNo permission granted. Allow this app in Health Connect.")
            else read()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Before midnight minus three hours would land on yesterday's clock time: keep one day.
        if (from > to) from = LocalTime.MIDNIGHT

        val pad = (16 * resources.displayMetrics.density).toInt()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        column.addView(TextView(this).apply {
            text = "选打球的日期和时间，然后点「读取」。\nPick the date and time you played, then tap Read."
            textSize = 16f
        })
        dateButton = Button(this).apply {
            setOnClickListener {
                DatePickerDialog(this@MainActivity, { _, y, m, d ->
                    date = LocalDate.of(y, m + 1, d)
                    labels()
                }, date.year, date.monthValue - 1, date.dayOfMonth).show()
            }
        }
        fromButton = Button(this).apply {
            setOnClickListener {
                TimePickerDialog(this@MainActivity, { _, h, min ->
                    from = LocalTime.of(h, min)
                    labels()
                }, from.hour, from.minute, true).show()
            }
        }
        toButton = Button(this).apply {
            setOnClickListener {
                TimePickerDialog(this@MainActivity, { _, h, min ->
                    to = LocalTime.of(h, min)
                    labels()
                }, to.hour, to.minute, true).show()
            }
        }
        column.addView(dateButton)
        column.addView(fromButton)
        column.addView(toButton)
        column.addView(Button(this).apply {
            text = "读取 / Read"
            setOnClickListener { start() }
        })
        output = TextView(this).apply {
            textSize = 14f
            setTextIsSelectable(true)
            setPadding(0, pad, 0, pad)
        }
        column.addView(output)
        column.addView(Button(this).apply {
            text = "复制结果 / Copy result"
            setOnClickListener {
                getSystemService(ClipboardManager::class.java)
                    .setPrimaryClip(ClipData.newPlainText("calories", output.text))
                Toast.makeText(this@MainActivity, "已复制 / Copied", Toast.LENGTH_SHORT).show()
            }
        })
        setContentView(ScrollView(this).apply {
            fitsSystemWindows = true
            addView(column)
        })
        labels()
    }

    private fun labels() {
        dateButton.text = "日期 / Date: $date"
        fromButton.text = "开始 / From: $from"
        toButton.text = "结束 / To: $to"
    }

    private fun show(text: String) {
        output.text = text
    }

    /** Health Connect there and allowed? Then read; otherwise send them to install or allow it. */
    private fun start() {
        when (HealthConnectClient.getSdkStatus(this, PROVIDER)) {
            HealthConnectClient.SDK_UNAVAILABLE -> {
                show("这台手机不支持 Health Connect。\nHealth Connect is not available on this phone.")
                return
            }
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                show("请先安装或更新 Health Connect，然后回来再点「读取」。\nInstall or update Health Connect, then come back and tap Read.")
                startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$PROVIDER&url=healthconnect%3A%2F%2Fonboarding"))
                        .setPackage("com.android.vending"),
                )
                return
            }
        }
        val client = HealthConnectClient.getOrCreate(this)
        lifecycleScope.launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                if (granted.containsAll(permissions)) read() else askPermissions.launch(permissions)
            } catch (e: Exception) {
                show("出错了 / Error: $e")
            }
        }
    }

    private fun read() {
        val start = LocalDateTime.of(date, from).atZone(zone).toInstant()
        val end = LocalDateTime.of(date, to).atZone(zone).toInstant()
        if (!end.isAfter(start)) {
            show("结束时间要晚于开始时间。\nThe end must be after the start.")
            return
        }
        show("读取中… / Reading…")
        val client = HealthConnectClient.getOrCreate(this)
        lifecycleScope.launch {
            show(
                try {
                    report(client, start, end)
                } catch (e: Exception) {
                    "出错了 / Error: $e"
                },
            )
        }
    }

    private suspend fun report(client: HealthConnectClient, start: Instant, end: Instant): String {
        val granted = client.permissionController.getGrantedPermissions()
        val range = TimeRangeFilter.between(start, end)
        val out = StringBuilder()
        out.appendLine("${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE}")
        out.appendLine("$date $from – $to ($zone)")
        out.appendLine()

        // What the real app will send: Health Connect's own total, with phone and watch de-duplicated.
        val total = client.aggregate(
            AggregateRequest(
                metrics = setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL, TotalCaloriesBurnedRecord.ENERGY_TOTAL),
                timeRangeFilter = range,
            ),
        )
        val active = total[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories
        val whole = total[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories
        out.appendLine("活动卡路里 Active: ${kcal(active)}")
        out.appendLine("总卡路里 Total: ${kcal(whole)}")
        out.appendLine("来源 Sources: ${total.dataOrigins.joinToString { it.packageName }.ifEmpty { "—" }}")
        out.appendLine()

        out.appendLine("活动卡路里记录 Active records:")
        out.append(bySource(all(client, ActiveCaloriesBurnedRecord::class, range)) { it.energy.inKilocalories })
        out.appendLine("总卡路里记录 Total records:")
        out.append(bySource(all(client, TotalCaloriesBurnedRecord::class, range)) { it.energy.inKilocalories })

        // Sessions of the whole day: one that started before the picked time still shows.
        val day = TimeRangeFilter.between(date.atStartOfDay(zone).toInstant(), date.plusDays(1).atStartOfDay(zone).toInstant())
        val sessions = all(client, ExerciseSessionRecord::class, day)
        val clock = DateTimeFormatter.ofPattern("HH:mm").withZone(zone)
        out.appendLine("当天的运动记录 Exercise sessions that day:")
        if (sessions.isEmpty()) out.appendLine("  —")
        for (s in sessions) {
            val inside = client.aggregate(
                AggregateRequest(
                    metrics = setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL, TotalCaloriesBurnedRecord.ENERGY_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(s.startTime, s.endTime),
                ),
            )
            out.appendLine(
                "  ${clock.format(s.startTime)}–${clock.format(s.endTime)} type ${s.exerciseType}" +
                    (if (s.exerciseType == ExerciseSessionRecord.EXERCISE_TYPE_BADMINTON) " (badminton)" else "") +
                    (s.title?.let { " \"$it\"" } ?: "") +
                    ", ${s.metadata.dataOrigin.packageName}" +
                    ", active ${kcal(inside[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories)}" +
                    ", total ${kcal(inside[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories)}",
            )
        }
        out.appendLine()
        out.appendLine("权限 Permissions: ${granted.intersect(permissions).size}/${permissions.size}")
        return out.toString()
    }

    private fun kcal(n: Double?): String = if (n == null) "没有数据 / no data" else "${Math.round(n)} kcal"

    /** Every record of a kind in the range, page after page. */
    private suspend fun <T : Record> all(client: HealthConnectClient, type: KClass<T>, range: TimeRangeFilter): List<T> {
        val records = mutableListOf<T>()
        var page: String? = null
        do {
            val response = client.readRecords(ReadRecordsRequest(recordType = type, timeRangeFilter = range, pageToken = page))
            records += response.records
            page = response.pageToken
        } while (page != null)
        return records
    }

    /** "  package: 12 records, 345 kcal" for each app that wrote some. */
    private fun <T : Record> bySource(records: List<T>, energy: (T) -> Double): String {
        if (records.isEmpty()) return "  —\n\n"
        val out = StringBuilder()
        for ((source, list) in records.groupBy { it.metadata.dataOrigin.packageName }) {
            out.appendLine("  $source: ${list.size} 条 records, ${Math.round(list.sumOf(energy))} kcal")
        }
        out.appendLine()
        return out.toString()
    }
}
