import AIEngineHeuristic from './AIEngineHeuristic.js';
import AIEngineLeveled from './AIEngineLeveled.js';

export default class Player {
    constructor(name,color,hover,ai,level) {
        this.name = name;
        this.color = color;
        this.hover = hover;
        if(ai == "ai-heuristic") {
            this.ai = true;
            this.aiEngine = new AIEngineHeuristic;
        } else if(ai == "ai-hybrid") {
            this.ai = true;
            // Leveled 4-phase engine; level defaults to Master when not
            // specified (e.g. the dev test-panel setups in TestCases.js).
            this.aiEngine = new AIEngineLeveled({ level });
        } else {
            this.ai = false;
            this.aiEngine = null;
        }
    }
}
