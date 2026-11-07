import AIEngine from './AIEngine.js';

export default class Player {
    constructor(name,color,hover,ai) {
        this.name = name;
        this.color = color;
        this.hover = hover;
        // ai carries the player-type dropdown's value: 'human',
        // 'ai-beginner' (pure heuristic), 'ai-intermediate'
        // (heuristic + Allcock step, no minimax), or
        // 'ai-advanced' (the full engine). Plain 'ai' from older
        // callers means advanced.
        if(ai == "ai" || ai == "ai-beginner" || ai == "ai-intermediate" || ai == "ai-advanced") {
            this.ai = true;
            this.aiLevel = ai == "ai-beginner" ? 'beginner' : ai == "ai-intermediate" ? 'intermediate' : 'advanced';
            this.aiEngine = new AIEngine({ level: this.aiLevel });
        } else {
            this.ai = false;
            this.aiLevel = null;
            this.aiEngine = null;
        }
    }
}
