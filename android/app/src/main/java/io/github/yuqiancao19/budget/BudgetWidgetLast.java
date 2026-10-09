package io.github.yuqiancao19.budget;

/** 2×1 widget: Left to spend and the last expense, side by side. Drawing is shared with BudgetWidget. */
public class BudgetWidgetLast extends BudgetWidget {
    @Override
    Kind kind() {
        return Kind.LAST;
    }
}
