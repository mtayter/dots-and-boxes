import AIEngine from './AIEngine.js';

export default class Player {
    constructor(name,color,hover,ai) {
        this.name = name;
        this.color = color;
        this.hover = hover;
        if(ai == "ai") {
            // The one unified AI engine, fixed strength.
            this.ai = true;
            this.aiEngine = new AIEngine();
        } else {
            this.ai = false;
            this.aiEngine = null;
        }
    }
}
