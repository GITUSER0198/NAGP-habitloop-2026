"""Deterministic recommendation rules over existing Analytics and Activity data."""

from dataclasses import dataclass
from fractions import Fraction

from app.schemas import ActivityHistory, Confidence, HourHistory, LogHistory, ScheduleValue

NEEDS_DATA = "needs at least 3 logs per time window"


@dataclass(frozen=True)
class Suggestion:
    activity: ActivityHistory
    kind: str
    current_value: ScheduleValue
    suggested_value: ScheduleValue
    reason: str
    confidence: Confidence


def confidence(attempts: int) -> Confidence:
    if attempts >= 30:
        return "high"
    if attempts >= 10:
        return "medium"
    return "low"


def display_hour(hour: int) -> str:
    return f"{hour % 12 or 12}:00 {'AM' if hour < 12 else 'PM'}"


def evaluate(
    activities: list[ActivityHistory], hours: list[HourHistory], logs: list[LogHistory],
) -> tuple[list[Suggestion], bool]:
    """Return candidates and whether any active activity has usable rule evidence.

    Hour aggregates are user-wide, as supplied by Analytics. Frequency uses full
    completions out of 14 daily opportunities. Partial 'done' logs are attempts.
    """
    suggestions: list[Suggestion] = []
    enough_data = False
    eligible = {row.hour: row for row in hours if row.attempts >= 3}
    best = max(eligible.values(), key=lambda row: (
        Fraction(row.successes, row.attempts), row.attempts, -row.hour,
    ), default=None)
    for activity in activities:
        current_hour = int(activity.preferred_time[:2])
        current = eligible.get(current_hour)
        if best is not None and current is not None:
            enough_data = True
            best_rate = Fraction(best.successes, best.attempts)
            current_rate = Fraction(current.successes, current.attempts)
            if best.hour != current_hour and best_rate - current_rate >= Fraction(15, 100):
                suggestions.append(Suggestion(
                    activity, "timing", {"preferred_time": activity.preferred_time},
                    {"preferred_time": f"{best.hour:02d}:00"},
                    f"You complete {activity.name} {best_rate:.0%} of the time around "
                    f"{display_hour(best.hour)} vs {current_rate:.0%} around {display_hour(current_hour)}",
                    confidence(min(best.attempts, current.attempts)),
                ))
        activity_logs = [log for log in logs if log.activity_id == activity.id]
        if activity.frequency != "daily" or len(activity_logs) < 3:
            continue
        enough_data = True
        completed_count = sum(log.status == "completed" for log in activity_logs)
        # Below 50% over 14 daily opportunities, the specified formula yields 3.
        target = max(3, completed_count // 2)
        if completed_count < 7 and target < activity.target_per_week:
            suggestions.append(Suggestion(
                activity, "frequency", {"target_per_week": activity.target_per_week},
                {"target_per_week": target},
                f"You completed {activity.name} {completed_count} of the last 14 daily targets "
                f"({completed_count / 14:.0%}). Try a target of {target} per week.",
                confidence(len(activity_logs)),
            ))
    return suggestions, enough_data
