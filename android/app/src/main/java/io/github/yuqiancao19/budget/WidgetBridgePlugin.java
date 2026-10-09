package io.github.yuqiancao19.budget;

import android.content.Context;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the web app hand its current numbers to the home-screen widget.
 * Called from app.js every time the app saves, so the widget always matches the app.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        Context ctx = getContext();
        ctx.getSharedPreferences(BudgetWidget.PREFS, Context.MODE_PRIVATE).edit()
            .putString("month", call.getString("month", ""))           // "2026-10"
            .putString("monthName", call.getString("monthName", ""))   // "October"
            .putLong("left", Math.round(call.getDouble("left", 0.0)))  // cents
            .putLong("budget", Math.round(call.getDouble("budget", 0.0)))
            .putLong("spent", Math.round(call.getDouble("spent", 0.0)))
            .putBoolean("showBudget", call.getBoolean("showBudget", true))
            .putBoolean("showSpent", call.getBoolean("showSpent", true))
            .putBoolean("showPerDay", call.getBoolean("showPerDay", false))
            .putBoolean("showDaysLeft", call.getBoolean("showDaysLeft", false))
            .putString("lastEmoji", call.getString("lastEmoji", ""))
            .putString("lastName", call.getString("lastName", ""))
            .putString("lastNote", call.getString("lastNote", ""))
            .putLong("lastAmount", Math.round(call.getDouble("lastAmount", 0.0)))
            .putString("lastDate", call.getString("lastDate", ""))      // "2026-10-09", or "" if none
            .putBoolean("ready", true)
            .apply();
        BudgetWidget.updateAll(ctx);
        call.resolve();
    }
}
