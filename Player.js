import AIEngineHeuristic from './AIEngineHeuristic.js';
import AIEngineLeveled from './AIEngineLeveled.js';

export default class Player {
    constructor(name,color,hover,ai) {
        this.name = name;
        this.color = color;
        this.hover = hover;
        if(ai == "ai-heuristic") {
            this.ai = true;
            this.aiEngine = new AIEngineHeuristic;
        } else if(ai == "ai-hybrid") {
            this.ai = true;
            // Leveled 4-phase engine, fixed strength.
            this.aiEngine = new AIEngineLeveled();
        } else {
            this.ai = false;
            this.aiEngine = null;
        }
    }
}
