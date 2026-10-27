import AIEngineLeveled from './AIEngineLeveled.js';

export default class Player {
    constructor(name,color,hover,ai) {
        this.name = name;
        this.color = color;
        this.hover = hover;
        if(ai == "ai-hybrid" || ai == "ai-heuristic") {
            // One unified AI engine (Leveled). 'ai-heuristic' is a retired
            // alias: it now gets the unified engine, which seat-balanced
            // evals show is never worse than the old heuristic mode.
            this.ai = true;
            // Leveled 4-phase engine, fixed strength.
            this.aiEngine = new AIEngineLeveled();
        } else {
            this.ai = false;
            this.aiEngine = null;
        }
    }
}
