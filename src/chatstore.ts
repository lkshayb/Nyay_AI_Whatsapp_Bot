type Msg = { role: "user" | "model"; text: string; time: number };
const store = new Map<string, Msg[]>();

export function appendMessage(userId: string, msg: Msg) {
    const arr = store.get(userId) ?? [];
    arr.push(msg);
    store.set(userId, arr);
}

export function getHistory(userId: string){
    const contents: { role: string; parts: { text: string }[] }[] = [];
    const editmap= store.get(userId) ?? [];
    for (const value of editmap) { 
        contents.push({
            role: value.role,
            parts: [{ text: value.text }]
        });
    }

    return JSON.stringify(contents, null, 2)
}
