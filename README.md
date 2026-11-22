# The Odyssey at the Cinema: An Exploration of Modern-Day Film

How to run The Odyssey at the Cinema:

Begin by downloading the dataset at this link: https://drive.google.com/file/d/1xfW9qOJan2qr-2xQnd_-SAJoMuZZYdBT/view?usp=sharing
- This is a subset of the Kaggle 1 Million Movies Dataset filtered for releases after 2016

Drag and drop the dataset (`TMDB_2016plus.csv`) into the `/data` folder.

- Make sure you are using the Jupyter kernel we have configured for the class.
- Run `conda activate dvjupyter` in the terminal.
- Navigate to the project file in your directory: `cd <YOUR_PATH_HERE>/FinalProject-Hayden-Kirkeide-HLK21`
- In the terminal, run `python api.py`. This creates the JSON files the project relies on.
- You can run it either directly on VSCode using the Integrated Browser or through `localhost`. 
- To run it on `localhost`, open a new terminal and run `python3 -m http.server 8000`.
- Copy and paste the `localhost` address with `/8000` appended at the end into a Chrome browser to view the full scrollytelling website. 
- You can also command click the `[::]` in the terminal and it will open in VSCode's integrated browser. 