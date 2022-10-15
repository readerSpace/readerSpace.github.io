const taskValue = document.getElementsByClassName('task_value')[0];
const taskSubmit = document.getElementsByClassName('task_submit')[0];
const taskList = document.getElementsByClassName('task_list')[0];

const paramName_value = document.getElementsByClassName('task_value')[0];
const param_submit = document.getElementsByClassName('task_submit')[0];
const paramList = document.getElementById('paramList')[0];

arr_paramList = ["やる気","コスト"]
arr_taskList = [["運動",2,5],["勉強",3,4]]
id_count = 1
// 追加ボタンを作成
const addTasks = (task) => {
  // 入力したタスクを追加・表示
  listItem = document.createElement('tr');
  id_count += 1;
  id = id_count;
  listItem.setAttribute('id',id)
  const head = document.createElement("th");
  head.innerHTML = task[0];
  listItem.appendChild(head);
  for(i=1;i<task.length;i++){
    data = document.createElement("td");
    data.innerText = task[i];
    listItem.appendChild(data)
  }
  const showItem = taskList.appendChild(listItem);
//   showItem.innerHTML = task;

  // タスクに削除ボタンを付与
  const deleteButton = document.createElement('button');
  deleteButton.innerHTML = 'Delete';
  listItem.appendChild(deleteButton);

  // 削除ボタンをクリックし、イベントを発動（タスクが削除）
  deleteButton.addEventListener('click', evt => {
    evt.preventDefault();
    deleteTasks(deleteButton);
  });
};

// 削除ボタンにタスクを消す機能を付与
const deleteTasks = (deleteButton) => {
  const chosenTask = deleteButton.closest('tr');
  taskList.removeChild(chosenTask);
};

// 追加ボタンをクリックし、イベントを発動（タスクが追加）
taskSubmit.addEventListener('click', evt => {
  evt.preventDefault();
  const taskName = taskValue.value;
  var task = new Array(arr_paramList.length+1)
  task[0] = taskName
  addTasks(task);
  taskValue.value = '';
});

taskValue.addEventListener('keypress', evt => {
    evt.preventDefault();
    const taskName = taskValue.value;
    var task = new Array(arr_paramList.length+1)
    task[0] = taskName
    for(i=1;i<=arr_paramList.length;i++){
        task[i] = 0
    }
    addTasks(task);
    taskValue.value = '';
});
  
function deleteRow(arr, row) {
    arr = arr.slice(0); // make copy
    arr.splice(row - 1, 1);
    return arr;
 }

function deleteCol(arr,col) {
    arr = arr.slice(0); // make copy
    for(var i=0; i<ary.length; i++){    //このfor文で行を回す
        arr[i].splice(col-1, 1);  
    }
    return arr
}