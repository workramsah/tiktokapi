"use client"

import Link from "next/link";
import { useRef } from "react";

export default function Page(){
    const inputRef = useRef(null);
    console.log(inputRef)

        function handleInputChange() {
            inputRef.current.focus()
        }
    return(
        <div>
            <div>dashboard page</div>
            <button onClick={handleInputChange}>Copy</button>
            <Link href="/terms-and-conditions">Terms and Conditions</Link>
            <Link href="/privacy-policy">Privacy Policy</Link>
            <input placeholder="Enter your text here..."ref={inputRef}></input>
        </div>
    )
}