package dev.llmat.badminton

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

/** "Why does this app read my health data": Health Connect opens it from its permission screen. */
class RationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val text = TextView(this).apply {
            setText(R.string.rationale)
            textSize = 16f
            setPadding(pad, pad, pad, pad)
        }
        setContentView(ScrollView(this).apply {
            fitsSystemWindows = true
            addView(text)
        })
    }
}
