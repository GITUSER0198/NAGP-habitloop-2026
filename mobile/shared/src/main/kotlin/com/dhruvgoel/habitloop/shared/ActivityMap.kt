package com.dhruvgoel.habitloop.shared

/** Default mapping of watch workout types to the user's habits. Cycle prefers "Cycle to Work". */
object ActivityMap {
    fun build(acts: List<Activity>): Map<String, String> {
        if (acts.isEmpty()) return emptyMap()
        fun find(vararg words: String): String? =
            acts.firstOrNull { a -> words.any { a.name.contains(it, ignoreCase = true) } }?.id
        val fallback: String = (acts.firstOrNull { it.category == "fitness" } ?: acts.first()).id
        val walk: String = find("walk") ?: fallback
        val run: String = find("run", "jog") ?: walk
        val cycle: String = find("cycle to work") ?: find("cycle", "bike") ?: fallback
        return mapOf("walk" to walk, "run" to run, "cycle" to cycle, "steps" to walk)
    }
}
