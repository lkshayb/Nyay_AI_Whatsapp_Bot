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
    try{
        const entry = req.body?.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages:string = value?.messages;
        if (Array.isArray(messages) && messages.length > 0) {
            const msg = messages[0];
            const from = msg.from;                      
            const text = msg.text?.body || "";           
            appendMessage(entry.id, { role: "user", text: messages[0].text.body, time: Date.now() });
            const history = getHistory(entry.id);
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
    const url = `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`;
    console.log("Using token present?:", !!process.env.WHATSAPP_TOKEN);
    const resp = await axios.post(
        url,
        {
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body }
        },
        {
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    );
    console.log("status", resp.status, "data", resp.data);
}

async function getResponse(text:string,history:Array<Object>):Promise<string | undefined>{
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
            
            {
                role:"model",
                parts : [
                    {
                        text: `
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
                        `,
                    }
                ]
            },
            {
                role:"user",
                parts : [{text : history + text}]
            },
        ],
    });
    return response.text
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));