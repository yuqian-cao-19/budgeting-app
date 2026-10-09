package io.github.yuqiancao19.budget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.RemoteViews;

import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * Home-screen widget showing Left to spend, plus Budget and Spent when it's wide enough.
 * Its numbers come from the app (see WidgetBridgePlugin); it only works out ~$/day and days left
 * from today's date, so those stay current between app opens.
 */
public class BudgetWidget extends AppWidgetProvider {

    static final String PREFS = "budget_widget";
    private static final int WIDE_DP = 180; // about 3 home-screen cells

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(ctx, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager manager, int id, Bundle options) {
        render(ctx, manager, id); // resized: show or hide the extra numbers
    }

    static void updateAll(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        for (int id : manager.getAppWidgetIds(new ComponentName(ctx, BudgetWidget.class))) render(ctx, manager, id);
    }

    private static String money(long cents) {
        String s = NumberFormat.getCurrencyInstance(Locale.US).format(Math.abs(cents) / 100.0);
        return cents < 0 ? "−" + s : s;
    }

    // Drops ".00" on round amounts (like the app's columns) so Budget and Spent fit beside the big number.
    private static String moneyShort(long cents) {
        return cents % 100 == 0 ? money(cents).replace(".00", "") : money(cents);
    }

    private static void render(Context ctx, AppWidgetManager manager, int id) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_budget);

        Intent open = new Intent(ctx, MainActivity.class);
        v.setOnClickPendingIntent(R.id.widget_root,
            PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        if (!p.getBoolean("ready", false)) {
            v.setTextViewText(R.id.widget_label, "BUDGET");
            v.setTextViewText(R.id.widget_left, "Open app");
            v.setViewVisibility(R.id.widget_sub, View.GONE);
            v.setViewVisibility(R.id.widget_stats, View.GONE);
            manager.updateAppWidget(id, v);
            return;
        }

        long left = p.getLong("left", 0);
        Calendar now = Calendar.getInstance();
        String thisMonth = String.format(Locale.US, "%04d-%02d", now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1);
        boolean current = thisMonth.equals(p.getString("month", ""));

        String month = p.getString("monthName", "");
        String shortMonth = month.length() > 3 ? month.substring(0, 3) : month; // "October" -> "Oct"
        v.setTextViewText(R.id.widget_label, (shortMonth + " · Left to spend").toUpperCase(Locale.US));
        v.setTextViewText(R.id.widget_left, money(left));
        v.setTextColor(R.id.widget_left, left < 0 ? 0xFFF2867A : 0xFF8EA8EA);

        // Per-day and days left depend only on the date, so the widget keeps them current itself.
        List<String> sub = new ArrayList<>();
        if (!current) {
            sub.add("New month: open the app to update");
        } else {
            int daysLeft = now.getActualMaximum(Calendar.DAY_OF_MONTH) - now.get(Calendar.DAY_OF_MONTH) + 1;
            // Kept short (whole dollars, "23d") so it fits under the big number next to Budget and Spent.
            if (p.getBoolean("showPerDay", false) && left > 0) sub.add("~" + moneyShort(left / daysLeft / 100 * 100) + "/day");
            if (p.getBoolean("showDaysLeft", false)) sub.add(daysLeft + "d left");
        }
        v.setTextViewText(R.id.widget_sub, TextUtils.join(" · ", sub));
        v.setViewVisibility(R.id.widget_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);

        // Budget and Spent only fit when the widget is about 3 cells wide or more.
        Bundle opts = manager.getAppWidgetOptions(id);
        boolean wide = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) >= WIDE_DP;
        boolean showBudget = wide && p.getBoolean("showBudget", true);
        boolean showSpent = wide && p.getBoolean("showSpent", true);
        v.setTextViewText(R.id.widget_budget, moneyShort(p.getLong("budget", 0)));
        v.setTextViewText(R.id.widget_spent, moneyShort(p.getLong("spent", 0)));
        v.setViewVisibility(R.id.widget_budget_box, showBudget ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.widget_spent_box, showSpent ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.widget_stats, showBudget || showSpent ? View.VISIBLE : View.GONE);

        manager.updateAppWidget(id, v);
    }
}
