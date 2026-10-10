package io.github.yuqiancao19.budget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Home-screen widgets. Three sizes, each its own entry in the widget picker:
 *   3×1  Left to spend, plus Savings and Spent beside it (this class)
 *   1×1  Left to spend only (BudgetWidgetSmall)
 *   2×1  Left to spend and the last expense, side by side (BudgetWidgetLast)
 * Numbers come from the app (see WidgetBridgePlugin). The widget only works out what depends on today's
 * date (~$/day, days left, "Today"/"Yesterday"), so those stay current between app opens.
 */
public class BudgetWidget extends AppWidgetProvider {

    static final String PREFS = "budget_widget";
    private static final int WIDE_DP = 180; // about 3 home-screen cells

    enum Kind { WIDE, SMALL, LAST }

    /** Which widget this provider draws; the subclasses override it. */
    Kind kind() {
        return Kind.WIDE;
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(ctx, manager, id, kind());
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager manager, int id, Bundle options) {
        render(ctx, manager, id, kind()); // resized: show or hide the extra numbers
    }

    /** Redraws every Budget widget on the home screen, whatever its size. */
    static void updateAll(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        draw(ctx, manager, BudgetWidget.class, Kind.WIDE);
        draw(ctx, manager, BudgetWidgetSmall.class, Kind.SMALL);
        draw(ctx, manager, BudgetWidgetLast.class, Kind.LAST);
    }

    private static void draw(Context ctx, AppWidgetManager manager, Class<?> provider, Kind kind) {
        for (int id : manager.getAppWidgetIds(new ComponentName(ctx, provider))) render(ctx, manager, id, kind);
    }

    private static String money(long cents) {
        String s = NumberFormat.getCurrencyInstance(Locale.US).format(Math.abs(cents) / 100.0);
        return cents < 0 ? "−" + s : s;
    }

    // Drops ".00" on round amounts (like the app's columns) so numbers fit in small spaces.
    private static String moneyShort(long cents) {
        return cents % 100 == 0 ? money(cents).replace(".00", "") : money(cents);
    }

    // "Today", "Yesterday", or "Oct 6", worked out against today's date.
    private static String dayLabel(String iso, Calendar now) {
        try {
            SimpleDateFormat parse = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            Date d = parse.parse(iso);
            String today = parse.format(now.getTime());
            Calendar y = (Calendar) now.clone();
            y.add(Calendar.DAY_OF_MONTH, -1);
            if (iso.equals(today)) return "Today";
            if (iso.equals(parse.format(y.getTime()))) return "Yesterday";
            return new SimpleDateFormat("MMM d", Locale.US).format(d);
        } catch (Exception e) {
            return "";
        }
    }

    private static int layoutFor(Kind kind) {
        switch (kind) {
            case SMALL: return R.layout.widget_small;
            case LAST: return R.layout.widget_last;
            default: return R.layout.widget_budget;
        }
    }

    /**
     * How much bigger than the default to draw text, from the widget's current size. Each kind has the size
     * (in dp) its default text was designed for; the smaller of the width and height ratios wins so text never
     * outgrows the widget. Uses the minimum sizes, which hold on both screens of a foldable and in landscape.
     */
    private static float scaleFor(Kind kind, Bundle opts) {
        int w = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int h = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        if (w <= 0 || h <= 0) return 1f;
        float baseW, baseH;
        switch (kind) {
            case SMALL: baseW = 70; baseH = 70; break;
            case LAST: baseW = 170; baseH = 60; break;
            default: baseW = 210; baseH = 60; break; // the big number fits itself to width, so width can be generous
        }
        return Math.max(1f, Math.min(2.6f, Math.min(w / baseW, h / baseH)));
    }

    private static void textSize(RemoteViews v, int id, float sp, float scale) {
        v.setTextViewTextSize(id, TypedValue.COMPLEX_UNIT_SP, sp * scale);
    }

    // The big numbers shrink to fit their box, so a taller box means bigger text. (Android 12+; older
    // versions keep the default box and the number stays its normal size.)
    private static void boxHeight(RemoteViews v, int id, float dp, float scale) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) v.setViewLayoutHeight(id, dp * scale, TypedValue.COMPLEX_UNIT_DIP);
    }

    private static void applyScale(RemoteViews v, Kind kind, float s) {
        switch (kind) {
            case SMALL:
                textSize(v, R.id.widget_label, 10, s);
                boxHeight(v, R.id.widget_left, 28, s);
                textSize(v, R.id.widget_left_unit, 10, s);
                break;
            case LAST:
                textSize(v, R.id.widget_label, 9, s);
                boxHeight(v, R.id.widget_left, 28, s);
                boxHeight(v, R.id.widget_divider, 34, s);
                textSize(v, R.id.widget_last_title, 12, s);
                textSize(v, R.id.widget_last_amount, 14, s);
                textSize(v, R.id.widget_last_when, 10, s);
                break;
            default:
                // Savings and Spent sit in narrow columns, so they grow less than the big number to stay on screen.
                float small = Math.min(s, 1.6f);
                textSize(v, R.id.widget_label, 10, Math.min(s, 1.3f)); // the label is long; keep it on one line
                boxHeight(v, R.id.widget_left, 32, s);
                textSize(v, R.id.widget_sub, 11, small);
                textSize(v, R.id.widget_savings, 13, small);
                textSize(v, R.id.widget_savings_label, 10, small);
                textSize(v, R.id.widget_spent, 13, small);
                textSize(v, R.id.widget_spent_label, 10, small);
        }
    }

    private static void render(Context ctx, AppWidgetManager manager, int id, Kind kind) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layoutFor(kind));
        Bundle opts = manager.getAppWidgetOptions(id);
        applyScale(v, kind, scaleFor(kind, opts));

        Intent open = new Intent(ctx, MainActivity.class);
        v.setOnClickPendingIntent(R.id.widget_root,
            PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        if (!p.getBoolean("ready", false)) {
            v.setTextViewText(R.id.widget_label, "BUDGET");
            v.setTextViewText(R.id.widget_left, "Open app");
            if (kind == Kind.WIDE) {
                v.setViewVisibility(R.id.widget_sub, View.GONE);
                v.setViewVisibility(R.id.widget_stats, View.GONE);
            }
            if (kind == Kind.LAST) v.setViewVisibility(R.id.widget_last, View.GONE);
            manager.updateAppWidget(id, v);
            return;
        }

        long left = p.getLong("left", 0);
        Calendar now = Calendar.getInstance();
        String thisMonth = String.format(Locale.US, "%04d-%02d", now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1);
        boolean current = thisMonth.equals(p.getString("month", ""));
        String month = p.getString("monthName", "");
        String shortMonth = (month.length() > 3 ? month.substring(0, 3) : month).toUpperCase(Locale.US); // "OCT"

        v.setTextViewText(R.id.widget_left, money(left));
        v.setTextColor(R.id.widget_left, left < 0 ? 0xFFF2867A : 0xFF8EA8EA);

        if (kind == Kind.SMALL) {
            // Too small for a sentence: the month on top, "left" underneath.
            v.setTextViewText(R.id.widget_label, current ? shortMonth : shortMonth + " · OPEN APP");
            manager.updateAppWidget(id, v);
            return;
        }

        if (kind == Kind.LAST) {
            v.setTextViewText(R.id.widget_label, shortMonth + " · LEFT");
            String lastDate = p.getString("lastDate", "");
            boolean hasLast = current && !lastDate.isEmpty();
            v.setViewVisibility(R.id.widget_last, View.VISIBLE);
            if (hasLast) {
                String note = p.getString("lastNote", "");
                v.setTextViewText(R.id.widget_last_title, p.getString("lastEmoji", "") + " " + p.getString("lastName", ""));
                v.setTextViewText(R.id.widget_last_amount, money(p.getLong("lastAmount", 0)));
                v.setTextViewText(R.id.widget_last_when,
                    dayLabel(lastDate, now) + (note.isEmpty() ? "" : " · " + note));
            } else {
                v.setTextViewText(R.id.widget_last_title, current ? "No expenses yet" : "New month");
                v.setTextViewText(R.id.widget_last_amount, "");
                v.setTextViewText(R.id.widget_last_when, current ? "" : "Open the app to update");
            }
            manager.updateAppWidget(id, v);
            return;
        }

        v.setTextViewText(R.id.widget_label, shortMonth + " · LEFT TO SPEND");

        // WIDE: optional ~$/day and days left under the number, Savings and Spent beside it.
        List<String> sub = new ArrayList<>();
        if (!current) {
            sub.add("New month: open the app to update");
        } else {
            int daysLeft = now.getActualMaximum(Calendar.DAY_OF_MONTH) - now.get(Calendar.DAY_OF_MONTH) + 1;
            // Kept short (whole dollars, "23d") so it fits under the big number next to Savings and Spent.
            if (p.getBoolean("showPerDay", false) && left > 0) sub.add("~" + moneyShort(left / daysLeft / 100 * 100) + "/day");
            if (p.getBoolean("showDaysLeft", false)) sub.add(daysLeft + "d left");
        }
        v.setTextViewText(R.id.widget_sub, TextUtils.join(" · ", sub));
        v.setViewVisibility(R.id.widget_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);

        // Savings and Spent only fit when the widget is about 3 cells wide or more.
        boolean wide = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) >= WIDE_DP;
        boolean showSavings = wide && p.getBoolean("showSavings", true);
        boolean showSpent = wide && p.getBoolean("showSpent", true);
        v.setTextViewText(R.id.widget_savings, moneyShort(p.getLong("savings", 0)));
        v.setTextViewText(R.id.widget_spent, moneyShort(p.getLong("spent", 0)));
        v.setViewVisibility(R.id.widget_savings_box, showSavings ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.widget_spent_box, showSpent ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.widget_stats, showSavings || showSpent ? View.VISIBLE : View.GONE);

        manager.updateAppWidget(id, v);
    }
}
