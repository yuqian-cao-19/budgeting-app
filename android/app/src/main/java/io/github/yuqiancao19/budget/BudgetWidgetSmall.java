package io.github.yuqiancao19.budget;

/** 1×1 widget: just Left to spend. Drawing is shared with BudgetWidget. */
public class BudgetWidgetSmall extends BudgetWidget {
    @Override
    Kind kind() {
        return Kind.SMALL;
    }
}
