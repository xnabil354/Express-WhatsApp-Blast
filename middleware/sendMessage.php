<?php

// Function to read input from the command line with a prompt
function readCommandLineInput($prompt)
{
    echo $prompt;
    return trim(fgets(STDIN));
}

// Main function to send messages to phone numbers
function sendMessages($imageurl, $sleepTime, $message, $listFile)
{
    $listx = explode("\n", file_get_contents($listFile));

    $curl = curl_init();

    curl_setopt_array($curl, array(
        CURLOPT_URL => 'http://localhost:8000/send-media',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_ENCODING => '',
        CURLOPT_MAXREDIRS => 10,
        CURLOPT_TIMEOUT => 0,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_CUSTOMREQUEST => 'POST',
    ));

    foreach ($listx as $value) {
        $postData = array(
            'number' => $value,
            'sleepTime' => $sleepTime,
            'caption' => $message,
            'file' => $imageurl,
        );
        curl_setopt($curl, CURLOPT_POSTFIELDS, $postData);

        $response = json_decode(curl_exec($curl), true);

        if ($response['status']) {
            echo "Message sent to " . $value . "\n";
        }

        sleep(10);
    }

    curl_close($curl);
}

// Usage
$imageurl = readCommandLineInput("Enter the image URL : ");
$sleepTime = readCommandLineInput("Enter the Delay Message : ");
$message = readCommandLineInput("Enter the message : ");
$listFile = readCommandLineInput("Enter phone number lists file: (ex: phone.txt) ");

sendMessages($imageurl, $sleepTime, $message, $listFile);
