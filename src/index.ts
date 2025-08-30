import express from "express";
import type { Request, Response } from "express";
import axios from "axios";
import "dotenv/config"; 
import { GoogleGenAI } from "@google/genai";
import { appendMessage, getHistory} from "./chatstore.ts";
const ai = new GoogleGenAI({ apiKey: "AIzaSyDfrQIQ_YsFQywWIvrhXO-ZcRmIXcP-mAE"});

const app = express();
app.use(express.json());

//webhook connection endpoint
app.get('/webhook',(req:Request,res:Response) => {
    console.log("REACHED AUTH WEBHOOK ENDPOINT")
    console.log(
        req.query["hub.mode"],
        req.query["hub.verify_token"],
        req.query["hub.challenge"]
    );
    console.log("subscribe",process.env.WHATSAPP_VERIFY_TOKEN)
    if(req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(req.query["hub.challenge"]);
    return res.sendStatus(403);
})

//Testing endpoint
app.get('/test',(req,res) => res.send("SERVER IS RUNNING, PLEASE ACCESS THROUGH WHATSAPP API"))

//main webhook post endpoint
app.post('/webhook',async (req:Request,res:Response) => {
    console.log("***REACHED WEBHOOK ENDPOINT FOR MESSAGING***")
    res.status(200);
    try{
        const entry = req.body?.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages= value?.messages as any[];
        console.log(messages)
        if (Array.isArray(messages) && messages.length > 0) {
            const msg = messages[0];
            const from = msg.from;                      
            const text = msg.text?.body || "";           
            appendMessage(entry.id, { role: "user", text: messages[0].text.body, time: Date.now() });
            const history = getHistory(entry.id) || [];
            const replyText = await getResponse(text,history);
            
            appendMessage(entry.id, { role: "model", text: replyText, time: Date.now() });
            
            if(replyText){
                await sendWhatsappText(from, replyText);
            }
            else console.log("error")
        }
        res.sendStatus(200);
    }catch(e){
        console.error("Webhook error:", e);
        res.sendStatus(200); 
    }
})

//function to forward message to whatsapp
async function sendWhatsappText(to: string, body: string) {
    console.log("Using token present?:", !!process.env.WHATSAPP_TOKEN);
    console.log("crnt time : ",Date.now())
    const resp = await axios.post(
        `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body }
        },
        {
            headers: {Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,"Content-Type": "application/json"}
        }
    );
    console.log("after time : ",Date.now())
    console.log("status", resp.status, "data", resp.data);
}

async function getResponse(text:string,history:Array<Object>):Promise<string | undefined>{
    const SYSTEM_PROMPT = `
        You are Nyay AI, an AI-powered legal awareness assistant trained on Indian laws.
        Guidelines:
            1. Role & Scope
                - Provide legal awareness based on Indian Kanoon and IPC/Acts.
                - Do not act as a lawyer. Always clarify: “I am not a lawyer, this is only for legal awareness.”
                - If unsure, ask the user for clarification instead of guessing.

            2. Style & Tone
                - Be empathetic in sensitive cases (e.g., domestic violence, harassment).
                - Reply in a friendly, conversational manner.
                - Always respond in the same language as the user (English, Hindi, Tamil, etc.).

            3. Response Length
                - Keep responses short and precise (100–150 words max, hard limit 250 words).
                - Avoid unnecessary details or moral advice. Stick to law + awareness + next step.

            4. Content Rules
                - Cite relevant IPC sections, Acts, or case precedents briefly when useful.
                - Always keep responses in the context of Indian law only.
                - Never provide non-Indian legal advice.
            Use WhatsApp formatting conventions: *bold*, _italic_, ~strikethrough~, monospace


    `

    const KANNON_CONTEXT = `
        You are Nyay AI, an AI-powered legal awareness assistant trained on Indian laws.
        You have to write the search queary for indian kannon db, Analyse the users intent and if the user is refering to a crime or talking about a law,
        then you have to return the search query for the Indian Kanon DB.
        eg:
            1.  User: Police took my Vehicle Without notice.
                Model: Illegal seizure of vehicle.

            2.  User: Hello.
                Model: Non Law Query

    `
    
    const PROCESS_QUERY = `
        You are Nyay AI, and you have to process the Data of some laws I'm Providing you, take these and respond to the
        user's query, Make it concise, and short.

        Guidelines:
            1. Role & Scope
                - Do not act as a lawyer. Always clarify: “I am not a lawyer, this is only for legal awareness.”
                - If unsure, ask the user for clarification instead of guessing.

            2. Style & Tone
                - Be empathetic in sensitive cases (e.g., domestic violence, harassment).
                - Reply in a friendly, conversational manner.
                - Always respond in the same language as the user (English, Hindi, Tamil, etc.).

            3. Response Length
                - Keep responses short and precise (100–150 words max, hard limit 250 words).
                - Avoid unnecessary details or moral advice. Stick to law + awareness + next step.

            4. Content Rules
                - Cite relevant IPC sections, Acts, or case precedents briefly when useful.
                - Always keep responses in the context of Indian law only.
                - Never provide non-Indian legal advice.
            Use WhatsApp formatting conventions: *bold*, _italic_, ~strikethrough~, monospace
    `
    const contents = [{role:"model",parts : [{text: KANNON_CONTEXT}]},{role:"user",parts : [{text: history + text}]},];

    const response = await ai.models.generateContent({model: "gemini-2.5-flash",contents});

    const rsp = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if(rsp){
        if(rsp == "Non Law Query"){
            const contents = [
                {
                    role:"model",
                    parts : [{text:  SYSTEM_PROMPT + history}]
                },
                {
                    role:"user",
                    parts : [{text: history + text}]
                },
            ];
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents
            });
            return response.candidates?.[0]?.content?.parts?.[0]?.text
        }
        else{
            let rsp_tailored = ""
            for(let i=0;i<rsp.length;i++){
                if(rsp[i] == " ") rsp_tailored = rsp_tailored + "+"
                else rsp_tailored = rsp_tailored + rsp[i]
            }
            const fetch_query = await axios.post(
                `https://api.indiankanoon.org/search/?formInput=${rsp_tailored}`,
                {},
                {
                    headers: {
                        Authorization: `Token ${process.env.INDIAN_KANOON_API_KEY}`,
                        "Content-Type": "application/json"
                    }
                }
            )
            const contents = [
                {
                    role:"model",
                    parts : [{text: PROCESS_QUERY + history}]
                },
                {
                    role:"user",
                    parts : [{text: JSON.stringify(fetch_query.data,null,2)}]
                },
            ];
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents
            });
            return response.candidates?.[0]?.content?.parts?.[0]?.text
        }
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));