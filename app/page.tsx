import Link from "next/link";

export default function Page(){
    return(
        <div>
            <div>home page</div>
            <Link href="/terms-and-conditions">Terms and Conditions</Link>
            <Link href="/privacy-policy">Privacy Policy</Link>
        </div>
    )
}